/*
 * ambilight.c - Feature-Art "service": liest Bilder vom HDMI-Capture-Stick (V4L2), nimmt die
 * Farben an den vier Bildrändern, glättet sie und schickt sie an den WS281x-Streifen.
 *
 * Einstellungen kommen vom Server:
 *   beim Start als --name=wert (Geräte-Einstellungen über load_config aus leds.c, danach die
 *   Feature-Einstellungen), im Betrieb als UDP-Nachricht "name: wert" auf Port 9000.
 * Unbekannte Einstellungen werden ignoriert.
 *
 * Dependencies (auf dem Raspberry Pi):
 *   sudo apt install build-essential cmake git
 *   git clone https://github.com/jgarff/rpi_ws281x
 *   cd rpi_ws281x && cmake -B build && cmake --build build && sudo cmake --install build
 *
 * Bauen:  make
 * Start:  sudo ./ambilight     (root wird für DMA/PWM von rpi_ws281x gebraucht)
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <getopt.h>
#include <math.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/select.h>
#include <unistd.h>
#include <linux/videodev2.h>
#include <sys/socket.h>
#include <arpa/inet.h>

#include <ws2811/ws2811.h>

#include "leds.h"

/*************** Global Variables *****************************************************************/
#define UDP_PORT         9000           // the server sends the live settings here
#define CAP_WIDTH        640
#define CAP_HEIGHT       480
#define CAP_MAX_BUFFERS  4
#define SIGNAL_TIMEOUT_S 2              // no frame for this long -> "Kein HDMI-Signal!"

// automatic detection of black bars above and below the picture (letterbox)
#define AUTO_BARS          1            // 0 = off, 1 = on
#define BAR_LUMA_THRESHOLD 40           // Y value (16 = black, 235 = white) above which a sample is picture
#define BAR_SAMPLES        32           // samples per row
#define BAR_MIN_BRIGHT     8            // a row is picture if at least this many samples are brighter
#define BAR_MAX_PERCENT    30           // bars are never assumed to be higher than this % of the frame
#define BAR_TOLERANCE      4            // changes of up to this many rows are ignored (noise)
#define BAR_GROW_FRAMES    90           // frames (~3 s) bigger bars have to be seen before they are used
#define SMOOTH_RATIO     0.85
#define DARK_GAMMA       0.2

/*************** Changeable Variables *****************************************************************/
// Startwerte, solange der Server nichts anderes schickt (Kommandozeile beim Start, danach UDP)
int black_grid_w = 9, black_grid_h = 37;

// Feature Variablen
double brightness = 0.7, smooth_ratio = 0.85, dark_gamma = 0.2;
// Stärke der Farbkanäle, 1.0 = unverändert (die Seite schickt Prozent)
double strength_red = 1.0, strength_green = 1.0, strength_blue = 1.0;
int resize_size = 18, distance_left = 1, distance_top = 1, distance_right = 1, distance_bottom = 1;

// Namen der Einstellungen, Reihenfolge passt zu OPT_SETTING_BASE (siehe main)
#define OPT_SETTING_BASE 3001
static const char *SETTING_NAMES[] = {
    "brightness", "smooth_ratio", "dark_gamma", "resize_size",
    "distance_left", "distance_top", "distance_right", "distance_bottom",
    "strength_red", "strength_green", "strength_blue",
};
#define SETTING_COUNT ((int)(sizeof SETTING_NAMES / sizeof *SETTING_NAMES))

typedef struct {
    int fd;
    int width, height, bytesperline;
    unsigned n_buffers;
    void *start[CAP_MAX_BUFFERS];
    size_t length[CAP_MAX_BUFFERS];
} capture_t;

typedef struct { uint8_t r, g, b; } rgb_t;

typedef struct {
    int size;               // height of the black bar in pixel rows (same above and below)
    int grow_frames;        // how many frames in a row bigger bars were seen
    int grow_candidate;     // smallest of these bigger bars, becomes the new size
} letterbox_t;

static volatile sig_atomic_t running = 1;

static letterbox_t letterbox = { 0, 0, 0 };

/*************** Helper Functions *****************************************************************/
static void on_signal(int sig) {
    (void)sig;
    running = 0;
}

static inline uint8_t clamp_u8(int v) {
    return v < 0 ? 0 : v > 255 ? 255 : (uint8_t)v;
}

// source index that cv2.resize(..., interpolation=cv2.INTER_NEAREST) picks for destination index i
static inline int nearest(int i, int src_size, int dst_size) {
    if (dst_size < 1)                    // never divide by zero
        return 0;
    int s = (int)((long)i * src_size / dst_size);
    return s < src_size ? s : src_size - 1;
}

static inline int clamp_int(int value, int low, int high) {
    return value < low ? low : value > high ? high : value;
}

// takes one setting, from the command line at the start and from UDP later;
// returns 0 if the name is unknown or the value does not fit
static int set_setting(const char *name, int value) {
    if (strcmp(name, "brightness") == 0 && value >= 0 && value <= 100)
        brightness = value / 100.0;          // the page sends percent
    else if (strcmp(name, "smooth_ratio") == 0 && value >= 0 && value <= 100)
        smooth_ratio = value / 100.0;
    else if (strcmp(name, "dark_gamma") == 0 && value >= 0 && value <= 100)
        dark_gamma = value / 100.0;
    else if (strcmp(name, "strength_red") == 0 && value >= 0 && value <= 100)
        strength_red = value / 100.0;
    else if (strcmp(name, "strength_green") == 0 && value >= 0 && value <= 100)
        strength_green = value / 100.0;
    else if (strcmp(name, "strength_blue") == 0 && value >= 0 && value <= 100)
        strength_blue = value / 100.0;
    else if (strcmp(name, "resize_size") == 0 && value >= 1)
        resize_size = value;
    else if (strcmp(name, "distance_left") == 0 && value >= 0)
        distance_left = value;
    else if (strcmp(name, "distance_top") == 0 && value >= 0)
        distance_top = value;
    else if (strcmp(name, "distance_right") == 0 && value >= 0)
        distance_right = value;
    else if (strcmp(name, "distance_bottom") == 0 && value >= 0)
        distance_bottom = value;
    else
        return 0;
    return 1;
}

// the feature settings from the command line (--brightness=70 ...), the device settings are
// already read by load_config; unknown settings of other features are ignored
static void load_settings(int argc, char *argv[]) {
    struct option options[SETTING_COUNT + 1];
    for (int i = 0; i < SETTING_COUNT; i++)
        options[i] = (struct option){ SETTING_NAMES[i], required_argument, 0, OPT_SETTING_BASE + i };
    options[SETTING_COUNT] = (struct option){ 0, 0, 0, 0 };

    opterr = 0;
    int opt;
    while ((opt = getopt_long(argc, argv, "", options, NULL)) != -1) {
        int index = opt - OPT_SETTING_BASE;
        if (index >= 0 && index < SETTING_COUNT && !set_setting(SETTING_NAMES[index], atoi(optarg)))
            fprintf(stderr, "Ungültiger Wert für %s: %s\n", SETTING_NAMES[index], optarg);
    }
    optind = 1;   // damit weitere Durchläufe wieder von vorn anfangen
}

/*************** Capture **************************************************************************/
static void close_capture(capture_t *cap) {
    enum v4l2_buf_type type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    ioctl(cap->fd, VIDIOC_STREAMOFF, &type);
    for (unsigned i = 0; i < cap->n_buffers; i++)
        munmap(cap->start[i], cap->length[i]);
    close(cap->fd);
}

// cv2.VideoCapture(index, cv2.CAP_V4L2): open /dev/videoN as YUYV stream with mmap buffers
static int open_capture(capture_t *cap, int index) {
    char dev[32];
    snprintf(dev, sizeof dev, "/dev/video%d", index);
    memset(cap, 0, sizeof *cap);
    cap->fd = open(dev, O_RDWR | O_NONBLOCK);
    if (cap->fd < 0)
        return -1;

    struct v4l2_format fmt = { .type = V4L2_BUF_TYPE_VIDEO_CAPTURE };
    fmt.fmt.pix.width = CAP_WIDTH;
    fmt.fmt.pix.height = CAP_HEIGHT;
    fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_YUYV;
    fmt.fmt.pix.field = V4L2_FIELD_NONE;
    if (ioctl(cap->fd, VIDIOC_S_FMT, &fmt) < 0 || fmt.fmt.pix.pixelformat != V4L2_PIX_FMT_YUYV)
        goto fail;
    // the driver may pick a different resolution, use what it reports
    cap->width = fmt.fmt.pix.width;
    cap->height = fmt.fmt.pix.height;
    cap->bytesperline = fmt.fmt.pix.bytesperline ? (int)fmt.fmt.pix.bytesperline : cap->width * 2;

    struct v4l2_requestbuffers req = {
        .count = CAP_MAX_BUFFERS, .type = V4L2_BUF_TYPE_VIDEO_CAPTURE, .memory = V4L2_MEMORY_MMAP,
    };
    if (ioctl(cap->fd, VIDIOC_REQBUFS, &req) < 0 || req.count == 0)
        goto fail;

    unsigned count = req.count < CAP_MAX_BUFFERS ? req.count : CAP_MAX_BUFFERS;
    for (unsigned i = 0; i < count; i++) {
        struct v4l2_buffer buf = { .type = V4L2_BUF_TYPE_VIDEO_CAPTURE, .memory = V4L2_MEMORY_MMAP, .index = i };
        if (ioctl(cap->fd, VIDIOC_QUERYBUF, &buf) < 0)
            goto fail;
        void *start = mmap(NULL, buf.length, PROT_READ | PROT_WRITE, MAP_SHARED, cap->fd, buf.m.offset);
        if (start == MAP_FAILED)
            goto fail;
        cap->start[i] = start;
        cap->length[i] = buf.length;
        cap->n_buffers = i + 1;
        if (ioctl(cap->fd, VIDIOC_QBUF, &buf) < 0)
            goto fail;
    }

    enum v4l2_buf_type type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    if (ioctl(cap->fd, VIDIOC_STREAMON, &type) < 0)
        goto fail;
    return 0;

fail:
    close_capture(cap);
    return -1;
}

// cap.read(): 1 = frame in buf, 0 = try again, -1 = no signal
static int grab_frame(capture_t *cap, struct v4l2_buffer *buf) {
    fd_set fds;
    FD_ZERO(&fds);
    FD_SET(cap->fd, &fds);
    struct timeval tv = { SIGNAL_TIMEOUT_S, 0 };
    int r = select(cap->fd + 1, &fds, NULL, NULL, &tv);
    if (r < 0)
        return errno == EINTR ? 0 : -1;
    if (r == 0)
        return -1;

    memset(buf, 0, sizeof *buf);
    buf->type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    buf->memory = V4L2_MEMORY_MMAP;
    if (ioctl(cap->fd, VIDIOC_DQBUF, buf) < 0)
        return errno == EAGAIN || errno == EINTR ? 0 : -1;
    return 1;
}

static void release_frame(capture_t *cap, struct v4l2_buffer *buf) {
    ioctl(cap->fd, VIDIOC_QBUF, buf);
}

// pixel (x, y) of a YUYV frame converted to RGB (BT.601, same as OpenCV)
static rgb_t frame_pixel(const capture_t *cap, const uint8_t *frame, int x, int y) {
    const uint8_t *p = frame + (size_t)y * cap->bytesperline + (size_t)(x / 2) * 4;   // Y0 U Y1 V
    int c = ((x & 1) ? p[2] : p[0]) - 16;
    int d = p[1] - 128;
    int e = p[3] - 128;
    rgb_t out = {
        clamp_u8((298 * c + 409 * e + 128) >> 8),
        clamp_u8((298 * c - 100 * d - 208 * e + 128) >> 8),
        clamp_u8((298 * c + 516 * d + 128) >> 8),
    };
    return out;
}

/*************** Color Calculation ****************************************************************/
// get_dominant_color + calc_color_arr: fills new_pixels in LED order (left bottom->top,
// top left->right, right top->bottom, bottom right->left). Only the picture between the black
// bars (bar = bar height in rows) is used.
static void calc_color_arr(const capture_t *cap, const uint8_t *frame, int bar, rgb_t new_pixels[], led_config_t *config) {
    int w = cap->width;
    int top = bar, h = cap->height - 2 * bar;   // picture area without the bars
    int n = 0;

    // nearest() picks the left/top edge of a grid cell, so index resize_size - d is as far
    // from the right/bottom border as index d is from the left/top border;
    // clamp_int: a distance bigger than resize_size would read outside the frame
    int steps = resize_size < 1 ? 1 : resize_size;
    int x_left = nearest(clamp_int(distance_left, 0, steps), w, steps);
    int y_top = top + nearest(clamp_int(distance_top, 0, steps), h, steps);
    int x_right = nearest(steps - clamp_int(distance_right, 0, steps), w, steps);
    int y_bottom = top + nearest(steps - clamp_int(distance_bottom, 0, steps), h, steps);

    // left: column x_left, bottom to top
    for (int i = config->led_count_left - 1; i >= 0; i--)
        new_pixels[n++] = frame_pixel(cap, frame, x_left, top + nearest(i, h, config->led_count_left));
    // top: row y_top, left to right
    for (int i = 0; i < config->led_count_top; i++)
        new_pixels[n++] = frame_pixel(cap, frame, nearest(i, w, config->led_count_top), y_top);
    // right: column x_right, top to bottom
    for (int i = 0; i < config->led_count_right; i++)
        new_pixels[n++] = frame_pixel(cap, frame, x_right, top + nearest(i, h, config->led_count_right));
    // bottom: row y_bottom, right to left
    for (int i = config->led_count_bottom - 1; i >= 0; i--)
        new_pixels[n++] = frame_pixel(cap, frame, nearest(i, w, config->led_count_bottom), y_bottom);
}

// Returns 1 if the whole screen is black: samples a black_grid_w x black_grid_h grid spread over
// the full frame and checks if the mean of all color values is <= 0.5 (np.mean(resized_left) <= 0.5)
static int is_black_screen(const capture_t *cap, const uint8_t *frame) {
    long sum = 0;
    for (int y = 0; y < black_grid_h; y++) {
        for (int x = 0; x < black_grid_w; x++) {
            rgb_t p = frame_pixel(cap, frame, nearest(x, cap->width, black_grid_w), nearest(y, cap->height, black_grid_h));
            sum += p.r + p.g + p.b;
        }
    }
    return sum * 2 <= 3L * black_grid_w * black_grid_h;
}

/*************** Black Bar Detection **************************************************************/
// brightness (Y) of pixel (x, y) in a YUYV frame, every pixel has its own Y byte at x * 2
static inline int frame_luma(const capture_t *cap, const uint8_t *frame, int x, int y) {
    return frame[(size_t)y * cap->bytesperline + (size_t)x * 2];
}

// 1 if row y contains picture, 0 if it belongs to a black bar
static int is_picture_row(const capture_t *cap, const uint8_t *frame, int y) {
    int bright = 0;
    for (int i = 0; i < BAR_SAMPLES; i++)
        if (frame_luma(cap, frame, nearest(i, cap->width, BAR_SAMPLES), y) > BAR_LUMA_THRESHOLD)
            bright++;
    return bright >= BAR_MIN_BRIGHT;
}

// height of the black bar at the top (from_bottom = 0) or bottom (from_bottom = 1),
// -1 if there is no picture row within BAR_MAX_PERCENT of the frame height
static int measure_bar(const capture_t *cap, const uint8_t *frame, int from_bottom) {
    int max = cap->height * BAR_MAX_PERCENT / 100;
    for (int i = 0; i <= max; i++) {
        int y = from_bottom ? cap->height - 1 - i : i;
        if (is_picture_row(cap, frame, y))
            return i;
    }
    return -1;
}

// Letterbox bars always have the same height above and below, so both sides have to agree:
// the bars shrink at once when both sides show picture inside them (subtitles in only one bar
// are ignored) and only grow when both sides stay dark for BAR_GROW_FRAMES frames (a dark sky
// in only the upper part of the picture is ignored).
static void update_letterbox(const capture_t *cap, const uint8_t *frame) {
    int top = measure_bar(cap, frame, 0);
    int bottom = measure_bar(cap, frame, 1);
    if (top < 0 || bottom < 0) {   // too dark to tell
        letterbox.grow_frames = 0;
        return;
    }

    int smaller = top < bottom ? top : bottom;
    int bigger = top > bottom ? top : bottom;
    int old_size = letterbox.size;

    if (bigger < letterbox.size - BAR_TOLERANCE) {
        letterbox.size = bigger;
        letterbox.grow_frames = 0;
    } else if (smaller > letterbox.size + BAR_TOLERANCE) {
        if (letterbox.grow_frames == 0 || smaller < letterbox.grow_candidate)
            letterbox.grow_candidate = smaller;
        if (++letterbox.grow_frames >= BAR_GROW_FRAMES) {
            letterbox.size = letterbox.grow_candidate;
            letterbox.grow_frames = 0;
        }
    } else {
        letterbox.grow_frames = 0;
    }

    if (letterbox.size != old_size)
        printf("Schwarze Balken oben/unten: %d px\n", letterbox.size);
}

// get_smooth_color: darken dark colors, blend with the previous frame and write into the LED buffer
static void get_smooth_color(ws2811_led_t *leds, rgb_t new_pixels[], rgb_t old_pixels[], led_config_t *config) {
    for (int i = 0; i < config->led_count; i++) {
        rgb_t c = new_pixels[i];
        rgb_t o = old_pixels[i];
        double factor = pow((c.r + c.g + c.b) / 3.0 / 255.0, dark_gamma) * brightness;
        // strength_*: dämpft einzelne Farbkanäle, z. B. wenn der Streifen zu blau wirkt
        uint8_t r = clamp_u8((int)lrint(o.r * smooth_ratio + c.r * factor * strength_red * (1 - smooth_ratio)));
        uint8_t g = clamp_u8((int)lrint(o.g * smooth_ratio + c.g * factor * strength_green * (1 - smooth_ratio)));
        uint8_t b = clamp_u8((int)lrint(o.b * smooth_ratio + c.b * factor * strength_blue * (1 - smooth_ratio)));
        old_pixels[i] = (rgb_t){ r, g, b };
        leds[i] = ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
    }
}

/*************** Main Function ********************************************************************/
int main(int argc, char *argv[]) {
    struct sigaction sa = { .sa_handler = on_signal };   // no SA_RESTART, so select() wakes up
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);

    // Geräte-Einstellungen (Anzahl LEDs, Pin, DMA) und Feature-Einstellungen der Kommandozeile
    led_config_t config = load_config(argc, argv);
    load_settings(argc, argv);
    if (config.led_count < 1) {
        fprintf(stderr, "Keine LEDs: led_count_left/top/right/bottom angeben\n");
        return 1;
    }
    black_grid_h = config.led_count_left > 0 ? config.led_count_left : black_grid_h;

    rgb_t new_pixels[config.led_count];
    rgb_t old_pixels[config.led_count];
    memset(new_pixels, 0, sizeof new_pixels);
    memset(old_pixels, 0, sizeof old_pixels);

    // Initialize Socket
    int s = socket(AF_INET, SOCK_DGRAM | SOCK_NONBLOCK, 0);
    struct sockaddr_in addr = {
        .sin_family = AF_INET,
        .sin_port = htons(UDP_PORT),
        .sin_addr.s_addr = htonl(INADDR_LOOPBACK)
    };
    if (s < 0 || bind(s, (struct sockaddr *)&addr, sizeof addr) < 0)
        fprintf(stderr, "UDP-Port %d nicht verfügbar, Einstellungen kommen nur beim Start an\n", UDP_PORT);
    char sock_buf[64];

    // Initialize Capture Device
    capture_t cap;
    if (open_capture(&cap, 0) < 0) {
        printf("Fehler: HDMI-Capture-Device 0 nicht gefunden!\n");
        if (open_capture(&cap, 1) < 0) {
            printf("Fehler: HDMI-Capture-Device 1 nicht gefunden!\n");
            return 1;
        }
    }
    printf("Started Ambilight (%dx%d, %d LEDs)\n", cap.width, cap.height, config.led_count);

    // Initialize LED strip
    ws2811_t strip;
    if (leds_init(&strip, config.led_count, config.led_pin, config.led_dma, 255) < 0) {
        close_capture(&cap);
        return 1;
    }

    int exit_code = 0;
    while (running) {
        // Einstellungen vom Server: eine Nachricht je Zeile "name: wert"
        ssize_t n;
        while ((n = recv(s, sock_buf, sizeof sock_buf - 1, 0)) > 0) {
            sock_buf[n] = '\0';
            char name[32];
            int value;
            if (sscanf(sock_buf, "%31[a-z_]: %d", name, &value) == 2 && set_setting(name, value))
                printf("Einstellung übernommen: %s = %d\n", name, value);
            else
                printf("Unbekannte oder ungültige Einstellung: %s\n", sock_buf);
        }

        struct v4l2_buffer buf;
        int r = grab_frame(&cap, &buf);
        if (r == 0)
            continue;
        if (r < 0) {
            printf("Kein HDMI-Signal!\n");
            exit_code = 1;
            break;
        }

        const uint8_t *frame = cap.start[buf.index];
        int black = is_black_screen(&cap, frame);
        if (AUTO_BARS && !black)
            update_letterbox(&cap, frame);
        calc_color_arr(&cap, frame, letterbox.size, new_pixels, &config);
        release_frame(&cap, &buf);
        if (black)
            memset(old_pixels, 0, sizeof old_pixels);

        get_smooth_color(strip.channel[0].leds, new_pixels, old_pixels, &config);
        ws2811_return_t ret = ws2811_render(&strip);
        if (ret != WS2811_SUCCESS) {
            fprintf(stderr, "ws2811_render fehlgeschlagen: %s\n", ws2811_get_return_t_str(ret));
            exit_code = 1;
            break;
        }
    }

    leds_off(&strip);
    ws2811_fini(&strip);
    close_capture(&cap);
    return exit_code;
}
