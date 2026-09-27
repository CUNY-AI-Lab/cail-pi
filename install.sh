#!/bin/sh
# CUNY AI Lab × Pi setup for macOS and Linux:
#
#   curl -fsSL https://raw.githubusercontent.com/CUNY-AI-Lab/cail-pi/main/install.sh | sh
#
# Checks for Git, installs Pi with Pi's official installer (which installs
# Node.js too when needed), makes sure new terminals can find that Node.js,
# then runs the CUNY AI Lab setup, `npx @cuny-ai-lab/cail-pi`. Arguments are
# passed through to it:
#
#   curl -fsSL https://raw.githubusercontent.com/CUNY-AI-Lab/cail-pi/main/install.sh | sh -s -- --doctor
#
# All work happens in main(), called on the last line, so the whole script has
# been read before any command could consume the rest of it from the pipe.

PI_INSTALLER_URL="https://pi.dev/install.sh"
CAIL_PACKAGE="@cuny-ai-lab/cail-pi"

say() {
  printf '%s\n' "$*"
}

stop() {
  printf '\n%s\n\n' "$*" >&2
  exit 1
}

has_tty() {
  (: </dev/tty) 2>/dev/null
}

# This script arrives on stdin, so programs that prompt get the keyboard instead.
run_with_keyboard() {
  if has_tty; then
    "$@" </dev/tty
  else
    "$@" </dev/null
  fi
}

check_git() {
  if [ "$(uname -s)" = Darwin ]; then
    # /usr/bin/git is only a stub until Apple's Command Line Tools are installed.
    git_path=$(command -v git 2>/dev/null || true)
    if [ -n "$git_path" ] && { [ "$git_path" != /usr/bin/git ] || xcode-select -p >/dev/null 2>&1; }; then
      return 0
    fi
    stop "Git is not installed yet. Install Apple's Command Line Tools, which include Git:

  xcode-select --install

Click Install in the window that opens and wait for it to finish; it can take
several minutes. Then run the CUNY AI Lab setup command again."
  fi

  command -v git >/dev/null 2>&1 && return 0
  stop "Git is not installed yet. Install it with your package manager, for example:

  sudo apt install git     (Ubuntu, Debian)
  sudo dnf install git     (Fedora)

Then run the CUNY AI Lab setup command again."
}

node_dir() {
  printf '%s/pi-node/current/bin' "${XDG_DATA_HOME:-$HOME/.local/share}"
}

pi_bin_dir() {
  printf '%s/bin' "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
}

pi_works() {
  command -v pi >/dev/null 2>&1 && pi --version >/dev/null 2>&1
}
# Find a Pi and Node.js that Pi's installer set up, even before a new terminal.
use_pi_dirs() {
  for dir in "$(node_dir)" "$(pi_bin_dir)"; do
    [ -d "$dir" ] && PATH="$dir:$PATH"
  done
  export PATH
}

# The same file and line format Pi's installer uses, so neither adds a duplicate.
shell_config_file() {
  case "$(basename "${SHELL:-sh}")" in
    fish) printf '%s/.config/fish/config.fish' "$HOME" ;;
    zsh) printf '%s/.zshrc' "${ZDOTDIR:-$HOME}" ;;
    bash)
      if [ -f "$HOME/.bashrc" ]; then
        printf '%s/.bashrc' "$HOME"
      else
        printf '%s/.profile' "$HOME"
      fi
      ;;
    *) printf '%s/.profile' "$HOME" ;;
  esac
}

path_line() {
  # shellcheck disable=SC2016 # $PATH is written literally into the profile
  case "$(basename "${SHELL:-sh}")" in
    fish) printf 'fish_add_path "%s"' "$1" ;;
    *) printf 'export PATH="%s:$PATH"' "$1" ;;
  esac
}

# Pi's installer puts the Node.js it downloads on PATH only for its own run.
# Without this line `pi` fails in the next terminal: "env: node: No such file".
remember_node_dir() {
  dir=$(node_dir)
  [ -x "$dir/node" ] || return 0
  config=$(shell_config_file)
  line=$(path_line "$dir")
  if [ -f "$config" ] && grep -Fxq "$line" "$config"; then
    return 0
  fi
  mkdir -p "$(dirname "$config")"
  printf '\n# Node.js for Pi\n%s\n' "$line" >>"$config"
  say "Added Node.js to your PATH in $config"
  NEW_TERMINAL_NEEDED=1
}

install_pi() {
  use_pi_dirs
  if pi_works; then
    say "Pi $(pi --version 2>/dev/null) is already installed."
    return 0
  fi

  installer=$(mktemp "${TMPDIR:-/tmp}/pi-install.XXXXXX") || stop "Could not create a temporary file."
  if ! curl -fsSL "$PI_INSTALLER_URL" -o "$installer"; then
    rm -f "$installer"
    stop "Could not download Pi's installer from $PI_INSTALLER_URL. Check your internet connection and try again."
  fi
  if ! run_with_keyboard sh "$installer"; then
    rm -f "$installer"
    stop "Pi's installer did not finish. Fix the problem it reported, then run this setup command again."
  fi
  rm -f "$installer"
  NEW_TERMINAL_NEEDED=1

  use_pi_dirs
  pi_works || stop "Pi was installed, but it does not start yet. Open a new terminal window and run this setup command again."
}

main() {
  set -eu
  NEW_TERMINAL_NEEDED=0

  say ""
  say "CUNY AI Lab × Pi setup"
  say ""

  check_git
  install_pi
  remember_node_dir

  say ""
  say "Running the CUNY AI Lab setup..."
  # ${1+"$@"}: an empty "$@" trips `set -u` in the bash 3.2 behind macOS /bin/sh.
  run_with_keyboard npx --yes "$CAIL_PACKAGE" ${1+"$@"}

  if [ "$NEW_TERMINAL_NEEDED" = 1 ]; then
    say ""
    say "Open a new terminal window before you start Pi, so it can find the programs installed just now."
    say ""
  fi
}

main "$@"
