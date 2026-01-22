BUILD_DIR = web
SRC_DIR = src
LOG_DIR = logs
TEMP_BUILD_DIR = temp_build

# Define the compiler and flags
EMCC = emcc
EMCC_FLAGS = \
	-O3 -ffast-math \
	-flto \
	-std=c++17 \
	-msimd128 \
	-mbulk-memory \
	-fno-rtti \
	-fno-exceptions \
	-funroll-loops \
	-pthread \
	-DNDEBUG \
	-DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 \
	-s SHARED_MEMORY=1 \
	-s MODULARIZE=1 \
	-s EXPORT_NAME="createFluidEngine" \
	-s PTHREAD_POOL_SIZE=navigator.hardwareConcurrency \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s ENVIRONMENT=web,worker \
	-s DISABLE_EXCEPTION_CATCHING=1 \
	-s FILESYSTEM=0 \
	-s ASSERTIONS=0 \
	--bind \
	-Wno-pthreads-mem-growth

# Define source and output files
SOURCE_FILE = $(SRC_DIR)/engine.cpp
OUTPUT_FILE = $(BUILD_DIR)/engine.js
WEB_ASSETS = index.html style.css main.js renderer.js shaders.js

all: $(OUTPUT_FILE)

# Rule to compile the C++ code with staging folder strategy
$(OUTPUT_FILE): $(SOURCE_FILE) $(SRC_DIR)/engine.h
	@echo "Compiling C++ to WebAssembly with Make..."
	@mkdir -p $(LOG_DIR)
	@mkdir -p $(TEMP_BUILD_DIR)
	@mkdir -p $(BUILD_DIR)
	$(EMCC) $(EMCC_FLAGS) $(SOURCE_FILE) -o $(TEMP_BUILD_DIR)/engine.js
	@mv -f $(TEMP_BUILD_DIR)/engine.js $(BUILD_DIR)/
	@mv -f $(TEMP_BUILD_DIR)/engine.wasm $(BUILD_DIR)/
	@if [ -f $(TEMP_BUILD_DIR)/engine.worker.js ]; then mv -f $(TEMP_BUILD_DIR)/engine.worker.js $(BUILD_DIR)/; fi

# A target to build the full web package
build: $(OUTPUT_FILE) copy_assets

copy_assets:
	@echo "Copying web assets to $(BUILD_DIR)..."
	@cp $(WEB_ASSETS) $(BUILD_DIR)

clean:
	@echo "Cleaning build artifacts..."
	@rm -f $(BUILD_DIR)/engine.js $(BUILD_DIR)/engine.wasm $(BUILD_DIR)/engine.worker.js
	@rm -rf $(LOG_DIR)
	@rm -rf $(TEMP_BUILD_DIR)