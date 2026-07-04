class Opencode < Formula
  desc "Local-first AI coding agent for the terminal"
  homepage "https://github.com/3kaiu/opencode-x"
  license "MIT"
  version "1.17.13"

  on_macos do
    on_arm do
      url "https://github.com/3kaiu/opencode-x/releases/download/v#{version}/opencode-darwin-arm64.tar.gz"
      sha256 ""
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
      sha256 ""
    end
  end

  def install
    bin.install "opencode"
  end

  test do
    assert_match "opencode", shell_output("#{bin}/opencode --help")
  end
end