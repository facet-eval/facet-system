CC      ?= cc
CFLAGS  ?= -Wall -Wextra -std=c11 -O0 -g -Iinclude
AR      ?= ar
ARFLAGS  = rcs

LIB_SRCS = src/parser.c src/encoder.c src/header.c src/types.c src/io.c
LIB_OBJS = $(LIB_SRCS:.c=.o)
BIN_OBJ  = src/main.o
LIB      = libtlv.a
BIN      = tlv

.PHONY: all clean
all: $(BIN) $(LIB)

$(LIB): $(LIB_OBJS)
	$(AR) $(ARFLAGS) $@ $^

$(BIN): $(BIN_OBJ) $(LIB)
	$(CC) $(CFLAGS) -o $@ $(BIN_OBJ) $(LIB)

%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<

clean:
	rm -f $(LIB_OBJS) $(BIN_OBJ) $(LIB) $(BIN)
