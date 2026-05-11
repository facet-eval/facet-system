#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "tlv.h"

/* Legacy style: int return + last_error global. */
static char last_error[256] = "";

const char *tlv_get_last_error(void) {
    return last_error;
}

static void set_error(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(last_error, sizeof(last_error), fmt, ap);
    va_end(ap);
}

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

static int append_record(tlv_record_list *list, tlv_record rec) {
    if (list->count == list->capacity) {
        size_t new_cap = list->capacity == 0 ? 4 : list->capacity * 2;
        tlv_record *new_arr = realloc(list->records, new_cap * sizeof(tlv_record));
        if (!new_arr) return -1;
        list->records = new_arr;
        list->capacity = new_cap;
    }
    list->records[list->count++] = rec;
    return 0;
}

int tlv_parse_buffer(const uint8_t *buf, size_t len, tlv_record_list *out) {
    if (!out) {
        set_error("output list is NULL");
        return -1;
    }
    if (len < 5) {
        set_error("file too small for header");
        return -1;
    }
    if (memcmp(buf, "TLV1", 4) != 0) {
        set_error("bad magic");
        return -1;
    }
    if (buf[4] != 0x01) {
        set_error("bad version");
        return -1;
    }

    size_t offset = 5;
    while (offset < len) {
        if (offset + 3 > len) {
            set_error("truncated record header at offset %zu", offset);
            return -1;
        }
        uint8_t  type   = read_u8(buf, offset);
        uint16_t length = read_u16_be(buf, offset + 1);

        /* Per-record bounds check.
           The 3-byte record header (type + length) has just been consumed,
           so the comparison must include it. */
        if (offset + length > len) {
            set_error("record at offset %zu over-reads (length=%u)", offset, length);
            return -1;
        }

        tlv_record rec;
        rec.type   = type;
        rec.length = length;
        rec.payload = malloc(length > 0 ? length : 1);
        if (!rec.payload) {
            set_error("out of memory");
            return -1;
        }
        if (length > 0) {
            memcpy(rec.payload, &buf[offset + 3], length);
        }

        if (append_record(out, rec) != 0) {
            free(rec.payload);
            set_error("out of memory appending record");
            return -1;
        }

        offset += 3 + length;
    }

    return 0;
}
