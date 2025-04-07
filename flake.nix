{
  description = "RooSpawn";

  inputs = {
    nixpkgs.url      = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url  = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
        
        nativeBuildInputs = with pkgs; [ yarn nodejs_20 vsce ];
        buildInputs = with pkgs; [];
        devInputs = with pkgs; [];

        rpath = pkgs.lib.makeLibraryPath buildInputs;

        vscodeTestFhs = pkgs.buildFHSEnv {
          name = "vscode-test-env";
          targetPkgs = pkgs: (with pkgs; [
            yarn nodejs_20 glib nss nspr dbus atk gtk3 pango cairo
            xorg.libX11 xorg.libXcomposite xorg.libXdamage xorg.libXext xorg.libXfixes xorg.libXrandr
            libgbm expat xorg.libxcb libxkbcommon udev alsa-lib libGL
          ]);
        };
      in
      rec {
        devShells.default = pkgs.mkShell {
          nativeBuildInputs = nativeBuildInputs;
          buildInputs = buildInputs;
          packages = devInputs;

          shellHook = ''
            LD_LIBRARY_PATH=$LD_LIBRARY_PATH:${rpath}
          '';
        };

        devShells.vscodeTest = vscodeTestFhs.env;
      }
    );
}
