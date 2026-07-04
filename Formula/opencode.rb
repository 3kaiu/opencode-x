class OpencodeX < Formula
  desc "Local-first AI coding agent for the terminal (opencode-x fork)"
  homepage "https://github.com/3kaiu/opencode-x"
  license "MIT"
  version "1.17.13"

  on_macos do
    on_arm do
      url "https://github.com/3kaiu/opencode-x/releases/download/v#{version}/opencode-darwin-arm64.tar.gz"
      sha256 "75f028f37aa04eb56ccc8e146ccb99b633faa764b0094187c4d9fb4f73c48609"
    end
    on_intel do
      url "https://github.com/3kaiu/opencode-x/releases/download/v#{version}/opencode-darwin-x64.tar.gz"
      sha256 ""
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/3kaiu/opencode-x/releases/download/v#{version}/opencode-linux-arm64.tar.gz"
      sha256 ""
    end
    on_intel do
      url "https://github.com/3kaiu/opencode-x/releases/download/v#{version}/opencode-linux-x64.tar.gz"
      sha256 "9c738ab645439f4dc59eef542d3abbc68e73013758044df11d6db03dd6505d24"
    end
  end

  def install
    bin.install "opencodex"
    bin.install_symlink "opencodex" => "ocx"
  end

  test do
    assert_match "opencodex", shell_output("#{bin}/opencodex --help")
  end
end