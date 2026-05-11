/* Task 3 (refactor): tlv.h must expose the unified tlv_status API.
 *
 * Compiled by the oracle as:
 *   cc -I<workspace>/include test_refactor.c <workspace>/libtlv.a -o test_refactor
 *
 * Pre-refactor, the unmodified workspace's tlv.h returns int / pointers
 * with no `cap` parameter. This file's references to:
 *   tlv_status tlv_parse_buffer(...)
 *   tlv_status tlv_encode_int32(int32_t, uint8_t*, size_t, size_t*)
 * fail to typecheck → compile error → task fails (correctly).
 *
 * Post-refactor, the signatures match → compile succeeds → assertions
 * run → task passes.
 */
#include <stddef.h>
#include <stdint.h>

#include "tlv.h"

#define CHECK(expr) do { if (!(expr)) return 1; } while (0)

int main(void) {
    tlv_status s;

    /* Bad magic: "XXXX" + version byte. */
    uint8_t bad_magic[5] = {'X', 'X', 'X', 'X', 0x01};
    s = tlv_parse_buffer(bad_magic, sizeof(bad_magic), NULL);
    CHECK(s == TLV_ERR_BAD_MAGIC);

    /* Bad version: correct magic, wrong version byte. */
    uint8_t bad_version[5] = {'T', 'L', 'V', '1', 0x99};
    s = tlv_parse_buffer(bad_version, sizeof(bad_version), NULL);
    CHECK(s == TLV_ERR_BAD_VERSION);

    /* INT32 encode: 1 (type) + 2 (length) + 4 (payload) = 7 bytes. */
    uint8_t out[16];
    size_t out_len = 0;
    s = tlv_encode_int32(42, out, sizeof(out), &out_len);
    CHECK(s == TLV_OK);
    CHECK(out_len == 7);

    /* INT32 encode into a too-small buffer must report it. */
    s = tlv_encode_int32(42, out, 3, &out_len);
    CHECK(s == TLV_ERR_BUFFER_TOO_SMALL);

    return 0;
}
