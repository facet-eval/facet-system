#include <string.h>

#include "tlv.h"

tlv_status tlv_validate_header(const uint8_t *buf, size_t len) {
    if (len < 5) return TLV_ERR_TRUNCATED;
    if (memcmp(buf, "TLV1", 4) != 0) return TLV_ERR_BAD_MAGIC;
    if (buf[4] != 0x01) return TLV_ERR_BAD_VERSION;
    return TLV_OK;
}
