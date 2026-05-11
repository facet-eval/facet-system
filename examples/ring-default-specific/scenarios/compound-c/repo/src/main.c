#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include "tlv.h"

#define HEADER_SIZE 5
static const uint8_t HEADER_BYTES[HEADER_SIZE] = {'T', 'L', 'V', '1', 0x01};

static int cmd_dump(const char *path);
static int cmd_append(int argc, char **argv);

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: tlv <dump|append> ...\n");
        return 2;
    }
    if (strcmp(argv[1], "dump") == 0) {
        if (argc < 3) {
            fprintf(stderr, "usage: tlv dump <file>\n");
            return 2;
        }
        return cmd_dump(argv[2]);
    }
    if (strcmp(argv[1], "append") == 0) {
        return cmd_append(argc - 2, argv + 2);
    }
    fprintf(stderr, "tlv: unknown command: %s\n", argv[1]);
    return 2;
}

static int read_whole_file(const char *path, uint8_t **out, size_t *out_size) {
    FILE *f = fopen(path, "rb");
    if (!f) return -1;
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return -1; }
    long sz = ftell(f);
    if (sz < 0) { fclose(f); return -1; }
    if (fseek(f, 0, SEEK_SET) != 0) { fclose(f); return -1; }
    /* +16 bytes safety so any incidental over-read in legacy code paths
       lands in calloc-zeroed memory rather than UB. */
    uint8_t *buf = calloc((size_t)sz + 16, 1);
    if (!buf) { fclose(f); return -1; }
    if (sz > 0 && fread(buf, 1, (size_t)sz, f) != (size_t)sz) {
        free(buf);
        fclose(f);
        return -1;
    }
    fclose(f);
    *out = buf;
    *out_size = (size_t)sz;
    return 0;
}

static int cmd_dump(const char *path) {
    uint8_t *buf = NULL;
    size_t size = 0;
    if (read_whole_file(path, &buf, &size) != 0) {
        fprintf(stderr, "tlv: cannot read %s: %s\n", path, strerror(errno));
        return 1;
    }
    /* Validate header (legacy assert-style — aborts on bad input). */
    tlv_validate_header(buf, size);

    tlv_record_list list;
    tlv_record_list_init(&list);

    int rc = tlv_parse_buffer(buf, size, &list);
    if (rc != 0) {
        fprintf(stderr, "tlv: parse error: %s\n", tlv_get_last_error());
        tlv_record_list_free(&list);
        free(buf);
        return 1;
    }

    int dump_status = 0;
    for (size_t i = 0; i < list.count; i++) {
        if (tlv_dump_record(&list.records[i]) != 0) {
            fprintf(stderr,
                    "tlv: cannot dump record %zu (type=0x%02x, length=%u)\n",
                    i,
                    list.records[i].type,
                    list.records[i].length);
            dump_status = 1;
        }
    }

    tlv_record_list_free(&list);
    free(buf);
    return dump_status;
}

static int file_exists(const char *path) {
    struct stat st;
    return stat(path, &st) == 0;
}

static int append_bytes(const char *path, const uint8_t *bytes, size_t n) {
    FILE *f = fopen(path, "ab");
    if (!f) return -1;
    if (fwrite(bytes, 1, n, f) != n) {
        fclose(f);
        return -1;
    }
    fclose(f);
    return 0;
}

static int cmd_append(int argc, char **argv) {
    if (argc < 1) {
        fprintf(stderr, "usage: tlv append <file> --type=<type> --value=<value>\n");
        return 2;
    }
    const char *path = argv[0];
    const char *type_str = NULL;
    const char *value_str = NULL;
    for (int i = 1; i < argc; i++) {
        if (strncmp(argv[i], "--type=", 7) == 0) {
            type_str = argv[i] + 7;
        } else if (strncmp(argv[i], "--value=", 8) == 0) {
            value_str = argv[i] + 8;
        }
    }
    if (!type_str || !value_str) {
        fprintf(stderr, "tlv append: --type and --value are required\n");
        return 2;
    }

    /* Ensure the file has a valid header; create it on first append. */
    if (!file_exists(path)) {
        FILE *f = fopen(path, "wb");
        if (!f) {
            fprintf(stderr, "tlv: cannot create %s: %s\n", path, strerror(errno));
            return 1;
        }
        if (fwrite(HEADER_BYTES, 1, HEADER_SIZE, f) != HEADER_SIZE) {
            fclose(f);
            return 1;
        }
        fclose(f);
    } else {
        uint8_t *buf = NULL;
        size_t size = 0;
        if (read_whole_file(path, &buf, &size) == 0) {
            tlv_validate_header(buf, size);
            free(buf);
        }
    }

    uint8_t *bytes = NULL;
    size_t   n_bytes = 0;
    if (strcmp(type_str, "int32") == 0) {
        long v = strtol(value_str, NULL, 10);
        bytes = tlv_encode_int32((int32_t)v, &n_bytes);
    } else if (strcmp(type_str, "string") == 0) {
        bytes = tlv_encode_string(value_str, strlen(value_str), &n_bytes);
    } else {
        fprintf(stderr, "tlv append: unknown --type=%s\n", type_str);
        return 1;
    }
    if (!bytes) {
        fprintf(stderr, "tlv append: encode failed\n");
        return 1;
    }
    if (append_bytes(path, bytes, n_bytes) != 0) {
        fprintf(stderr, "tlv append: write failed: %s\n", strerror(errno));
        free(bytes);
        return 1;
    }
    free(bytes);
    return 0;
}
