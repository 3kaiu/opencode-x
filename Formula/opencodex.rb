class Opencodex < Formula
  desc "Local-first AI coding agent for the terminal (opencode-x fork)"
  homepage "https://github.com/3kaiu/opencode-x"
  license "MIT"
  version "1.17.15"

  on_macos do
    on_arm do
      url "https://github.com/3kaiu/opencode-x/releases/download/v#{version}/opencode-darwin-arm64.tar.gz"
      sha256 "9e365351733cb6826fea6f0390f71bc6d268cd5621bd52ecde2fb003d905fcde"
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
      sha256 "dc50434280659259e519392274feeef43c9ef2c5ff442d222bfc768d3c40c8a3"
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