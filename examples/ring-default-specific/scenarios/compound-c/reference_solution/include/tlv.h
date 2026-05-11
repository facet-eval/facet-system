#ifndef TLV_H
#define TLV_H

#include <stddef.h>
#include <stdint.h>

typedef enum {
    TLV_OK = 0,
    TLV_ERR_BAD_MAGIC,
    TLV_ERR_BAD_VERSION,
    TLV_ERR_TRUNCATED,
    TLV_ERR_UNKNOWN_TYPE,
    TLV_ERR_INVALID_LENGTH,
    TLV_ERR_BUFFER_TOO_SMALL,
    TLV_ERR_INVALID_VALUE,
    TLV_ERR_IO
} tlv_status;

#define TLV_TYPE_INT32        0x01
#define TLV_TYPE_STRING_UTF8  0x02
#define TLV_TYPE_BOOL         0x04

typedef struct {
    uint8_t  type;
    uint16_t length;
    uint8_t *payload;
} tlv_record;

typedef struct {
    tlv_record *records;
    size_t      count;
    size_t      capacity;
} tlv_record_list;

void tlv_record_list_init(tlv_record_list *list);
void tlv_record_list_free(tlv_record_list *list);

tlv_status tlv_parse_buffer(const uint8_t *buf, size_t len, tlv_record_list *out);
tlv_status tlv_encode_int32(int32_t value, uint8_t *out, size_t cap, size_t *out_len);
tlv_status tlv_encode_string(const char *s, size_t s_len, uint8_t *out, size_t cap, size_t *out_len);
tlv_status tlv_encode_bool(int value, uint8_t *out, size_t cap, size_t *out_len);
tlv_status tlv_validate_header(const uint8_t *buf, size_t len);

uint8_t  read_u8(const uint8_t *buf, size_t off);
void     write_u8(uint8_t *buf, size_t off, uint8_t v);
uint16_t read_u16_be(const uint8_t *buf, size_t off);
void     write_u16_be(uint8_t *buf, size_t off, uint16_t v);
int32_t  read_i32_be(const uint8_t *buf, size_t off);
void     write_i32_be(uint8_t *buf, size_t off, int32_t v);

const char *tlv_type_name(uint8_t type);
int         tlv_dump_record(const tlv_record *rec);

#endif
