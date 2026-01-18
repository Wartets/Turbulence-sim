class Renderer {
    constructor(canvas, width, height) {
        this.gl = canvas.getContext("webgl2", { preserveDrawingBuffer: false, alpha: false });
        if (!this.gl) throw new Error("WebGL2 not supported");
        
        this.gl.getExtension("EXT_color_buffer_float");
        const linearExtension = this.gl.getExtension("OES_texture_float_linear");
        
        this.filter = linearExtension ? this.gl.LINEAR : this.gl.NEAREST;

        this.width = width;
        this.height = height;
        
        this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);

        this.program = this.createProgram(VS_SOURCE, FS_SOURCE);
        this.particleProgram = this.createProgram(PARTICLE_VS, PARTICLE_FS);
        
        this.texUx = this.createTexture(this.gl.R32F, this.gl.FLOAT);
        this.texUy = this.createTexture(this.gl.R32F, this.gl.FLOAT);
        this.texRho = this.createTexture(this.gl.R32F, this.gl.FLOAT);
        this.texObstacles = this.createTexture(this.gl.R8, this.gl.UNSIGNED_BYTE);

        this.quadBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1
        ]), this.gl.STATIC_DRAW);

        this.particleBuffer = this.gl.createBuffer();

        this.gl.useProgram(this.program);
        this.uniforms = {
            velocity_x: this.gl.getUniformLocation(this.program, "u_velocity_x"),
            velocity_y: this.gl.getUniformLocation(this.program, "u_velocity_y"),
            density: this.gl.getUniformLocation(this.program, "u_density"),
            obstacles: this.gl.getUniformLocation(this.program, "u_obstacles"),
            mode: this.gl.getUniformLocation(this.program, "u_mode"),
            contrast: this.gl.getUniformLocation(this.program, "u_contrast"),
            brightness: this.gl.getUniformLocation(this.program, "u_brightness"),
            colorScheme: this.gl.getUniformLocation(this.program, "u_color_scheme"),
            obstacleColor: this.gl.getUniformLocation(this.program, "u_obstacle_color")
        };
    }

    createProgram(vs, fs) {
        const createShader = (type, src) => {
            const shader = this.gl.createShader(type);
            this.gl.shaderSource(shader, src);
            this.gl.compileShader(shader);
            if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
                console.error(this.gl.getShaderInfoLog(shader));
                return null;
            }
            return shader;
        };
        const prog = this.gl.createProgram();
        this.gl.attachShader(prog, createShader(this.gl.VERTEX_SHADER, vs));
        this.gl.attachShader(prog, createShader(this.gl.FRAGMENT_SHADER, fs));
        this.gl.linkProgram(prog);
        return prog;
    }

    createTexture(internalFormat, type) {
        const t = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, t);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.filter);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.filter);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, internalFormat, this.width, this.height, 0, this.gl.RED, type, null);
        return t;
    }

    draw(uxData, uyData, rhoData, barrierData, params) {
        this.gl.disable(this.gl.BLEND);
        this.gl.useProgram(this.program);
        this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        const positionLoc = this.gl.getAttribLocation(this.program, "a_position");
        this.gl.enableVertexAttribArray(positionLoc);
        this.gl.vertexAttribPointer(positionLoc, 2, this.gl.FLOAT, false, 0, 0);

        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texUx);
        this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.gl.RED, this.gl.FLOAT, uxData);
        this.gl.uniform1i(this.uniforms.velocity_x, 0);

        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texUy);
        this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.gl.RED, this.gl.FLOAT, uyData);
        this.gl.uniform1i(this.uniforms.velocity_y, 1);

        this.gl.activeTexture(this.gl.TEXTURE2);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texRho);
        this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.gl.RED, this.gl.FLOAT, rhoData);
        this.gl.uniform1i(this.uniforms.density, 2);

        this.gl.activeTexture(this.gl.TEXTURE3);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texObstacles);
        this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.gl.RED, this.gl.UNSIGNED_BYTE, barrierData);
        this.gl.uniform1i(this.uniforms.obstacles, 3);

        this.gl.uniform1i(this.uniforms.mode, params.mode);
        this.gl.uniform1f(this.uniforms.contrast, params.contrast);
        this.gl.uniform1f(this.uniforms.brightness, params.brightness);
        this.gl.uniform1i(this.uniforms.colorScheme, params.colorScheme);

        const color = params.obstacleColor;
        const r = parseInt(color.slice(1, 3), 16) / 255;
        const g = parseInt(color.slice(3, 5), 16) / 255;
        const b = parseInt(color.slice(5, 7), 16) / 255;
        this.gl.uniform3f(this.uniforms.obstacleColor, r, g, b);

        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    }

    drawParticles(particleData, count) {
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);

        this.gl.useProgram(this.particleProgram);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.particleBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, particleData, this.gl.DYNAMIC_DRAW);
        
        const posLoc = this.gl.getAttribLocation(this.particleProgram, "a_position");
        this.gl.enableVertexAttribArray(posLoc);
        this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, 0, 0);
        
        this.gl.uniform2f(this.gl.getUniformLocation(this.particleProgram, "u_resolution"), this.gl.canvas.width, this.gl.canvas.height);
        
        this.gl.drawArrays(this.gl.POINTS, 0, count);
        
        this.gl.disable(this.gl.BLEND);
    }
}