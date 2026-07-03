const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });

    const module = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = .ReleaseSmall,
    });

    const exe = b.addExecutable(.{
        .name = "token_counter",
        .root_module = module,
    });

    exe.entry = .disabled;
    exe.rdynamic = true;

    b.installArtifact(exe);
}
