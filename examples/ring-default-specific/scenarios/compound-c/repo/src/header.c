#include <assert.h>
#include <string.h>

#include "tlv.h"

/* Legacy style: assert on bad user input. Bad magic or bad version
   crashes the process. The refactor unifies this onto tlv_status. */
void tlv_validate_header(const uint8_t *buf, size_t len) {
    assert(len >= 5);
    assert(memcmp(buf, "TLV1", 4) == 0);
    assert(buf[4] == 0x01);
}
