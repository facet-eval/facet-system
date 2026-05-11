/* Regression test 4: I/O helper big-endian reciprocity.
 *
 * Compiled by the oracle as:
 *   cc -I<workspace>/include test_io_helpers.c <workspace>/libtlv.a -o test_io_helpers
 */
#include <stdint.h>
#include <stdio.h>

#include "tlv.h"

#define CHECK_U16(value) do {                                  \
    uint8_t buf[2];                                            \
    write_u16_be(buf, 0, (uint16_t)(value));                   \
    if (read_u16_be(buf, 0) != (uint16_t)(value)) {            \
        fprintf(stderr, "reg4: u16 round-trip failed for %u\n",\
                (unsigned)(value));                            \
        return 1;                                              \
    }                                                          \
} while (0)

#define CHECK_I32(value) do {                                  \
    uint8_t buf[4];                                            \
    write_i32_be(buf, 0, (int32_t)(value));                    \
    if (read_i32_be(buf, 0) != (int32_t)(value)) {             \
        fprintf(stderr, "reg4: i32 round-trip failed for %d\n",\
                (int)(value));                                 \
        return 1;                                              \
    }                                                          \
} while (0)

int main(void) {
    CHECK_U16(0);
    CHECK_U16(1);
    CHECK_U16(0x00FF);
    CHECK_U16(0xFF00);
    CHECK_U16(0xFFFF);

    CHECK_I32(0);
    CHECK_I32(-1);
    CHECK_I32(INT32_MIN);
    CHECK_I32(INT32_MAX);
    CHECK_I32(0x12345678);

    return 0;
}
