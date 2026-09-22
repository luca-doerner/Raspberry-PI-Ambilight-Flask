/*
 * ambilight.c - C port of static/python/ambilight.py
 *
 * Reads frames from an HDMI capture stick (V4L2), samples the colors along the
 * four screen edges, smooths them and sends them to a WS281x LED strip on GPIO 18.
 * Single-threaded, the configuration is compiled in as constants.
 *
 * Dependencies (on the Raspberry Pi):
 *   sudo apt install build-essential cmake git
 *   git clone https://github.com/jgarff/rpi_ws281x
 *   cd rpi_ws281x && cmake -B build && cmake --build build && sudo cmake --install build
 *
 * Build:  make
 * Run:    sudo ./ambilight      (root is needed for the DMA/PWM access of rpi_ws281x)
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/select.h>
#include <unistd.h>
#include <linux/videodev2.h>
#include <sys/socket.h>
#include <arpa/inet.h>

#include <ws2811/ws2811.h>

/*************** Configuration (values from config.json) ******************************************/
#define COUNT_LEFT       37
#define COUNT_TOP        71
#define COUNT_RIGHT      39
#define COUNT_BOTTOM     73
#define LED_COUNT        (COUNT_LEFT + COUNT_TOP + COUNT_RIGHT + COUNT_BOTTOM)   // 220
#define BRIGHTNESS       0.7

/*************** Global Variables *****************************************************************/
#define MODE             "Ambilight"

#define LED_PIN          18             // board.D18
#define LED_DMA          10
#define LED_STRIP        WS2811_STRIP_GRB

#define CAP_WIDTH        640
#define CAP_HEIGHT       480
#define CAP_MAX_BUFFERS  4
#define SIGNAL_TIMEOUT_S 2              // no frame for this long -> "Kein HDMI-Signal!"

#define RESIZE_SIZE      18              // the 9 in cv2.resize(frame, (9, count))
// how many grid steps (picture size / RESIZE_SIZE) the LED colors are taken away from each border
// of the picture (with AUTO_BARS the top/bottom border is the edge of the detected black bars)
#define DISTANCE_LEFT    1
#define DISTANCE_TOP     1
#define DISTANCE_RIGHT   1
#define DISTANCE_BOTTOM  1
#define BLACK_GRID_W     9              // sample grid for the black screen detection,
#define BLACK_GRID_H     COUNT_LEFT     // spread over the whole frame (like the old resized_left)

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
double brightness = BRIGHTNESS;
double smooth_ratio = SMOOTH_RATIO;
double dark_gamma = DARK_GAMMA;
unsigned int resize_size = RESIZE_SIZE;
unsigned int distance_left = DISTANCE_LEFT;
unsigned int distance_top = DISTANCE_TOP;
unsigned int distance_right = DISTANCE_RIGHT;
unsigned int distance_bottom = DISTANCE_BOTTOM;

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

static rgb_t new_pixels[LED_COUNT];
static rgb_t old_pixels[LED_COUNT];

static ws2811_t strip = {
    .freq = WS2811_TARGET_FREQ,
    .dmanum = LED_DMA,
    .channel = {
        [0] = { .gpionum = LED_PIN, .count = LED_COUNT, .invert = 0, .brightness = 255, .strip_type = LED_STRIP },
        [1] = { .gpionum = 0, .count = 0, .invert = 0, .brightness = 0 },
    },
};

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
    int s = (int)((long)i * src_size / dst_size);
    return s < src_size ? s : src_size - 1;
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
static void calc_color_arr(const capture_t *cap, const uint8_t *frame, int bar) {
    int w = cap->width;
    int top = bar, h = cap->height - 2 * bar;   // picture area without the bars
    int n = 0;

    // nearest() picks the left/top edge of a grid cell, so index resize_size - d is as far
    // from the right/bottom border as index d is from the left/top border
    int x_left = nearest(distance_left, w, resize_size);
    int y_top = top + nearest(distance_top, h, resize_size);
    int x_right = nearest(resize_size - distance_right, w, resize_size);
    int y_bottom = top + nearest(resize_size - distance_bottom, h, resize_size);

    // left: column x_left, bottom to top
    for (int i = COUNT_LEFT - 1; i >= 0; i--)
        new_pixels[n++] = frame_pixel(cap, frame, x_left, top + nearest(i, h, COUNT_LEFT));
    // top: row y_top, left to right
    for (int i = 0; i < COUNT_TOP; i++)
        new_pixels[n++] = frame_pixel(cap, frame, nearest(i, w, COUNT_TOP), y_top);
    // right: column x_right, top to bottom
    for (int i = 0; i < COUNT_RIGHT; i++)
        new_pixels[n++] = frame_pixel(cap, frame, x_right, top + nearest(i, h, COUNT_RIGHT));
    // bottom: row y_bottom, right to left
    for (int i = COUNT_BOTTOM - 1; i >= 0; i--)
        new_pixels[n++] = frame_pixel(cap, frame, nearest(i, w, COUNT_BOTTOM), y_bottom);
}

// Returns 1 if the whole screen is black: samples a BLACK_GRID_W x BLACK_GRID_H grid spread over
// the full frame and checks if the mean of all color values is <= 0.5 (np.mean(resized_left) <= 0.5)
static int is_black_screen(const capture_t *cap, const uint8_t *frame) {
    long sum = 0;
    for (int y = 0; y < BLACK_GRID_H; y++) {
        for (int x = 0; x < BLACK_GRID_W; x++) {
            rgb_t p = frame_pixel(cap, frame, nearest(x, cap->width, BLACK_GRID_W), nearest(y, cap->height, BLACK_GRID_H));
            sum += p.r + p.g + p.b;
        }
    }
    return sum * 2 <= 3L * BLACK_GRID_W * BLACK_GRID_H;
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
static void get_smooth_color(ws2811_led_t *leds) {
    for (int i = 0; i < LED_COUNT; i++) {
        rgb_t c = new_pixels[i];
        rgb_t o = old_pixels[i];
        double factor = pow((c.r + c.g + c.b) / 3.0 / 255.0, dark_gamma) * brightness;
        uint8_t r = clamp_u8((int)lrint(o.r * smooth_ratio + c.r * factor * (1 - smooth_ratio)));
        uint8_t g = clamp_u8((int)lrint(o.g * smooth_ratio + c.g * factor * (1 - smooth_ratio)));
        uint8_t b = clamp_u8((int)lrint(o.b * smooth_ratio + c.b * factor * (1 - smooth_ratio)));
        old_pixels[i] = (rgb_t){ r, g, b };
        leds[i] = ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
    }
}

// pixels.fill((0,0,0)); pixels.show()
static void leds_off(void) {
    memset(strip.channel[0].leds, 0, LED_COUNT * sizeof(ws2811_led_t));
    ws2811_render(&strip);
}

/*************** Main Function ********************************************************************/
int main(void) {
    struct sigaction sa = { .sa_handler = on_signal };   // no SA_RESTART, so select() wakes up
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);

    // Initialize Socket
    int s = socket(AF_INET, SOCK_DGRAM | SOCK_NONBLOCK, 0);
    struct sockaddr_in addr = {
        .sin_family = AF_INET,
        .sin_port = htons(9000),
        .sin_addr.s_addr = htonl(INADDR_LOOPBACK)
    };
    bind(s, (struct sockaddr *)&addr, sizeof addr);
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
    printf("Started " MODE " (%dx%d, %d LEDs)\n", cap.width, cap.height, LED_COUNT);

    // Initialize LED strip
    ws2811_return_t ret = ws2811_init(&strip);
    if (ret != WS2811_SUCCESS) {
        fprintf(stderr, "ws2811_init fehlgeschlagen: %s\n", ws2811_get_return_t_str(ret));
        close_capture(&cap);
        return 1;
    }

    int exit_code = 0;
    while (running) {
        // reload configuration
        ssize_t n;
        while ((n = recv(s, sock_buf, sizeof sock_buf - 1, 0)) > 0) {
            sock_buf[n] = '\0'; // Null-terminate the received data
            unsigned int value;
            if (sscanf(sock_buf, "brightness: %d", &value) == 1 && value <= 100) {
                brightness = value / 100.0;
            } else if (sscanf(sock_buf, "smooth_ratio: %d", &value) == 1 && value <= 100) {
                smooth_ratio = value / 100.0;
            } else if (sscanf(sock_buf, "dark_gamma: %d", &value) == 1 && value <= 100) {
                dark_gamma = value / 100.0;
            } else if (sscanf(sock_buf, "resize_size: %d", &value) == 1) {
                resize_size = value;
            } else if (sscanf(sock_buf, "distance_left: %d", &value) == 1) {
                distance_left = value;
            } else if (sscanf(sock_buf, "distance_right: %d", &value) == 1) {
                distance_right = value;
            } else if (sscanf(sock_buf, "distance_top: %d", &value) == 1) {
                distance_top = value;
            } else if (sscanf(sock_buf, "distance_bottom: %d", &value) == 1 ) {
                distance_bottom = value;
            } else {
                printf("Unknown configuration: %s\n", sock_buf);
            }
            printf("Configuration updated: %s\n", sock_buf);
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
        calc_color_arr(&cap, frame, letterbox.size);
        release_frame(&cap, &buf);
        if (black)
            memset(old_pixels, 0, sizeof old_pixels);

        get_smooth_color(strip.channel[0].leds);
        ret = ws2811_render(&strip);
        if (ret != WS2811_SUCCESS) {
            fprintf(stderr, "ws2811_render fehlgeschlagen: %s\n", ws2811_get_return_t_str(ret));
            exit_code = 1;
            break;
        }
    }

    leds_off();
    ws2811_fini(&strip);
    close_capture(&cap);
    return exit_code;
}
