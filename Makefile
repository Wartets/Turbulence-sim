BUILD_DIR = web
SRC_DIR = src

all: $(BUILD_DIR)/engine.js

$(BUILD_DIR)/engine.js: $(SRC_DIR)/engine.cpp $(SRC_DIR)/engine.h
	emcc $(SRC_DIR)/engine.cpp \
		-O3 \
		-s WASM=1 \
		-s ALLOW_MEMORY_GROWTH=1 \
		-s MODULARIZE=1 \
		-s EXPORT_NAME="createFluidEngine" \
		-s EXPORTED_RUNTIME_METHODS='["memory"]' \
		--bind \
		-o $@

clean:
	rm -f $(BUILD_DIR)/engine.js $(BUILD_DIR)/engine.wasm