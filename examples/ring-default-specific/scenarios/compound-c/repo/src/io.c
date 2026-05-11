#include "tlv.h"

uint8_t read_u8(const uint8_t *buf, size_t off) {
    return buf[off];
}

void write_u8(uint8_t *buf, size_t off, uint8_t v) {
    buf[off] = v;
}

uint16_t read_u16_be(const uint8_t *buf, size_t off) {
    return (uint16_t)(((uint16_t)buf[off] << 8) | (uint16_t)buf[off + 1]);
}

void write_u16_be(uint8_t *buf, size_t off, uint16_t v) {
    buf[off]     = (uint8_t)((v >> 8) & 0xFF);
    buf[off + 1] = (uint8_t)(v & 0xFF);
}

int32_t read_i32_be(const uint8_t *buf, size_t off) {
    uint32_t u = ((uint32_t)buf[off]     << 24)
               | ((uint32_t)buf[off + 1] << 16)
               | ((uint32_t)buf[off + 2] << 8)
               |  (uint32_t)buf[off + 3];
    return (int32_t)u;
}

void write_i32_be(uint8_t *buf, size_t off, int32_t v) {
    uint32_t u = (uint32_t)v;
    buf[off]     = (uint8_t)((u >> 24) & 0xFF);
    buf[off + 1] = (uint8_t)((u >> 16) & 0xFF);
    buf[off + 2] = (uint8_t)((u >> 8) & 0xFF);
    buf[off + 3] = (uint8_t)(u & 0xFF);
}
