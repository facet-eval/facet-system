#include <stdlib.h>
#include <string.h>

#include "tlv.h"

void tlv_record_list_init(tlv_record_list *list) {
    list->records = NULL;
    list->count = 0;
    list->capacity = 0;
}

void tlv_record_list_free(tlv_record_list *list) {
    if (!list) return;
    for (size_t i = 0; i < list->count; i++) {
        free(list->records[i].payload);
    }
    free(list->records);
    list->records = NULL;
    list->count = 0;
    list->capacity = 0;
}

static tlv_status append_record(tlv_record_list *list, tlv_record rec) {
    if (list->count == list->capacity) {
        size_t new_cap = list->capacity == 0 ? 4 : list->capacity * 2;
        tlv_record *new_arr = realloc(list->records, new_cap * sizeof(tlv_record));
        if (!new_arr) return TLV_ERR_IO;
        list->records = new_arr;
        list->capacity = new_cap;
    }
    list->records[list->count++] = rec;
    return TLV_OK;
}

tlv_status tlv_parse_buffer(const uint8_t *buf, size_t len, tlv_record_list *out) {
    if (len < 5) return TLV_ERR_TRUNCATED;
    if (memcmp(buf, "TLV1", 4) != 0) return TLV_ERR_BAD_MAGIC;
    if (buf[4] != 0x01) return TLV_ERR_BAD_VERSION;

    size_t offset = 5;
    while (offset < len) {
        if (offset + 3 > len) return TLV_ERR_TRUNCATED;
        uint8_t  type   = read_u8(buf, offset);
        uint16_t length = read_u16_be(buf, offset + 1);

        /* Per-record bounds check: must include the 3-byte record header. */
        if (offset + 3 + length > len) return TLV_ERR_TRUNCATED;

        if (out) {
            tlv_record rec;
            rec.type = type;
            rec.length = length;
            rec.payload = malloc(length > 0 ? length : 1);
            if (!rec.payload) return TLV_ERR_IO;
            if (length > 0) memcpy(rec.payload, &buf[offset + 3], length);
            tlv_status s = append_record(out, rec);
            if (s != TLV_OK) {
                free(rec.payload);
                return s;
            }
        }

        offset += 3 + length;
    }

    return TLV_OK;
}
