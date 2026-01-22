BUILD_DIR = web
SRC_DIR = src

# Define the compiler and flags
EMCC = emcc
EMCC_FLAGS = \
	-O3 \
	-std=c++17 \
	-msimd128 \
	-pthread \
	-s SHARED_MEMORY=1 \
	-s MODULARIZE=1 \
	-s EXPORT_NAME="createFluidEngine" \
	-s PTHREAD_POOL_SIZE=navigator.hardwareConcurrency \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s ENVIRONMENT=web,worker \
	--bind \
	-Wno-pthreads-mem-growth

# Define source and output files
SOURCE_FILE = $(SRC_DIR)/engine.cpp
OUTPUT_FILE = $(BUILD_DIR)/engine.js
WEB_ASSETS = index.html style.css main.js renderer.js shaders.js

all: $(OUTPUT_FILE)

# Rule to compile the C++ code
$(OUTPUT_FILE): $(SOURCE_FILE) $(SRC_DIR)/engine.h
	@echo "Compiling C++ to WebAssembly with Make..."
	$(EMCC) $(EMCC_FLAGS) $(SOURCE_FILE) -o $(OUTPUT_FILE)

# A target to build the full web package
build: $(OUTPUT_FILE) copy_assets

copy_assets:
	@echo "Copying web assets to $(BUILD_DIR)..."
	@cp $(WEB_ASSETS) $(BUILD_DIR)

clean:
	@echo "Cleaning build artifacts..."
	@rm -f $(BUILD_DIR)/engine.js $(BUILD_DIR)/engine.wasm $(BUILD_DIR)/engine.worker.js