{
  description = "AI todos";

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
        
        nativeBuildInputs = with pkgs; [ nodejs_23 ];
        buildInputs = with pkgs; [];
        devInputs = with pkgs; [];

        rpath = pkgs.lib.makeLibraryPath buildInputs;
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
      }
    );
}
