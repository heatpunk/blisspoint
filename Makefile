PKG = blisspoint.s9pk

.PHONY: all pack clean

all: pack

# Generate manifest
manifest.json: 
	@echo "Generating manifest.json..."
	@echo '{"type": "commonjs"}' > sdk-build/javascript/package.json
	@node -e "const m = require('./sdk-build/javascript/index.js'); const manifest = m.manifest || m.parsedManifest || m.default; if (!manifest) { console.error('No manifest found in bundle'); process.exit(1); } console.log(JSON.stringify(manifest, null, 2))" > manifest.json

pack: manifest.json
	@echo "Packing s9pk..."
	@mkdir -p assets
	@rm -rf ./javascript
	@cp -r sdk-build/javascript ./javascript
	@echo '{"type": "commonjs"}' > ./javascript/package.json
	start-cli s9pk pack \
		--javascript $(CURDIR)/javascript \
		--icon startos/icon.png \
		--instructions startos/instructions.md \
		--license LICENSE \
		--assets $(CURDIR)/assets \
		-o $(PKG)
	@rm -rf ./javascript

clean:
	rm -f $(PKG) manifest.json
	rm -rf sdk-build/javascript sdk-build/node_modules ./javascript
