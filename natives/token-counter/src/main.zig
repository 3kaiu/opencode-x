export fn count_tokens(input_ptr: [*]const u8, input_len: usize) usize {
    const input = input_ptr[0..input_len];
    var count: usize = 0;
    var i: usize = 0;
    while (i < input.len) {
        const byte = input[i];
        if (byte < 0x80) {
            count += 1;
            i += 1;
        } else if (byte < 0xE0) {
            count += 1;
            i += 2;
        } else if (byte < 0xF0) {
            count += 1;
            i += 3;
        } else {
            count += 1;
            i += 4;
        }
    }
    return count;
}
