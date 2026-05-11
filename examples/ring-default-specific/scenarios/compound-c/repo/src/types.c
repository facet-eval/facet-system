#include <stdio.h>

#include "tlv.h"

const char *tlv_type_name(uint8_t type) {
    switch (type) {
        case TLV_TYPE_INT32:       return "INT32";
        case TLV_TYPE_STRING_UTF8: return "STRING_UTF8";
        default:                   return NULL;
    }
}

int tlv_dump_record(const tlv_record *rec) {
    switch (rec->type) {
        case TLV_TYPE_INT32: {
            if (rec->length != 4) return -1;
            int32_t value = read_i32_be(rec->payload, 0);
            printf("INT32: %d\n", value);
            return 0;
        }
        case TLV_TYPE_STRING_UTF8: {
            printf("STRING_UTF8: \"%.*s\"\n",
                   (int)rec->length,
                   (const char *)rec->payload);
            return 0;
        }
        default:
            return -1;
    }
}
