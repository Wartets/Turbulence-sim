class Renderer {
    constructor(canvas, width, height) {
        this.gl = canvas.getContext("webgl2", { preserveDrawingBuffer: false, alpha: false });
        if (!this.gl) throw new Error("WebGL2 not supported");
        
        this.gl.getExtension("EXT_color_buffer_float");
        this.gl.getExtension("OES_texture_float_linear");
        
        const linearExtension = this.gl.getExtension("OES_texture_float_linear");
        this.filter = linearExtension ? this.gl.LINEAR : this.gl.NEAREST;

        this.width = width;
        this.height = height;
        
        this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);

        this.program = this.createProgram(VS_SOURCE, FS_SOURCE);
        this.particleRenderProgram = this.createProgram(PARTICLE_VS, PARTICLE_FS);
        this.particleUpdateProgram = this.createProgram(PARTICLE_UPDATE_VS, PARTICLE_UPDATE_FS);
        this.brushProgram = this.createProgram(BRUSH_VS, BRUSH_FS);
        
        this.texUx = this.createTexture(this.gl.R32F, this.gl.RED, this.gl.FLOAT, this.width, this.height);
        this.texUy = this.createTexture(this.gl.R32F, this.gl.RED, this.gl.FLOAT, this.width, this.height);
        this.texRho = this.createTexture(this.gl.R32F, this.gl.RED, this.gl.FLOAT, this.width, this.height);
        this.texObstacles = this.createTexture(this.gl.R8, this.gl.RED, this.gl.UNSIGNED_BYTE, this.width, this.height);
        this.texDye = this.createTexture(this.gl.R32F, this.gl.RED, this.gl.FLOAT, this.width, this.height);
        this.texTemperature = this.createTexture(this.gl.R32F, this.gl.RED, this.gl.FLOAT, this.width, this.height);

        this.quadBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1
        ]), this.gl.STATIC_DRAW);

        this.particleIndexBuffer = this.gl.createBuffer();
        this.particleFBO = this.gl.createFramebuffer();
        this.texPartA = null;
        this.texPartB = null;
        this.particleCount = 0;
        this.particleTexDim = 0;

        this.brushBuffer = this.gl.createBuffer();
        this.brushVertexCount = 6;
        const brushVerts = [
            -1, -1,  1, -1, -1,  1,
            -1,  1,  1, -1,  1,  1
        ];
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.brushBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(brushVerts), this.gl.STATIC_DRAW);

        this.gl.useProgram(this.program);
        this.uniforms = {
            velocity_x: this.gl.getUniformLocation(this.program, "u_velocity_x"),
            velocity_y: this.gl.getUniformLocation(this.program, "u_velocity_y"),
            density: this.gl.getUniformLocation(this.program, "u_density"),
            obstacles: this.gl.getUniformLocation(this.program, "u_obstacles"),
            dye: this.gl.getUniformLocation(this.program, "u_dye"),
            temperature: this.gl.getUniformLocation(this.program, "u_temperature"),
            mode: this.gl.getUniformLocation(this.program, "u_mode"),
            contrast: this.gl.getUniformLocation(this.program, "u_contrast"),
            brightness: this.gl.getUniformLocation(this.program, "u_brightness"),
            bias: this.gl.getUniformLocation(this.program, "u_bias"),
            power: this.gl.getUniformLocation(this.program, "u_power"),
            colorScheme: this.gl.getUniformLocation(this.program, "u_color_scheme"),
            obstacleColor: this.gl.getUniformLocation(this.program, "u_obstacle_color"),
            backgroundColor: this.gl.getUniformLocation(this.program, "u_background_color"),
            vorticityBipolar: this.gl.getUniformLocation(this.program, "u_vorticity_bipolar")
        };
        
        this.particleRenderUniforms = {
            positions: this.gl.getUniformLocation(this.particleRenderProgram, "u_positions"),
            resolution: this.gl.getUniformLocation(this.particleRenderProgram, "u_resolution"),
            size: this.gl.getUniformLocation(this.particleRenderProgram, "u_particle_size"),
            color: this.gl.getUniformLocation(this.particleRenderProgram, "u_particle_color")
        };

        this.particleUpdateUniforms = {
            currPos: this.gl.getUniformLocation(this.particleUpdateProgram, "u_curr_pos"),
            velX: this.gl.getUniformLocation(this.particleUpdateProgram, "u_vel_x"),
            velY: this.gl.getUniformLocation(this.particleUpdateProgram, "u_vel_y"),
            obstacles: this.gl.getUniformLocation(this.particleUpdateProgram, "u_obstacles"),
            dt: this.gl.getUniformLocation(this.particleUpdateProgram, "u_dt"),
            simDim: this.gl.getUniformLocation(this.particleUpdateProgram, "u_sim_dim"),
            seed: this.gl.getUniformLocation(this.particleUpdateProgram, "u_seed")
        };

        this.brushUniforms = {
            resolution: this.gl.getUniformLocation(this.brushProgram, "u_resolution"),
            center: this.gl.getUniformLocation(this.brushProgram, "u_center"),
            radius: this.gl.getUniformLocation(this.brushProgram, "u_radius"),
            color: this.gl.getUniformLocation(this.brushProgram, "u_color"),
            angle: this.gl.getUniformLocation(this.brushProgram, "u_angle"),
            aspect: this.gl.getUniformLocation(this.brushProgram, "u_aspect"),
            shape: this.gl.getUniformLocation(this.brushProgram, "u_shape")
        };
    }

    initParticles(count) {
        this.particleCount = count;
        this.particleTexDim = Math.ceil(Math.sqrt(count));
        const totalPixels = this.particleTexDim * this.particleTexDim;
        
        const initialData = new Float32Array(totalPixels * 4);
        for(let i=0; i<count; i++) {
            initialData[i*4 + 0] = Math.random() * this.width;
            initialData[i*4 + 1] = Math.random() * this.height;
            initialData[i*4 + 2] = 0; 
            initialData[i*4 + 3] = 0; 
        }

        if(this.texPartA) this.gl.deleteTexture(this.texPartA);
        if(this.texPartB) this.gl.deleteTexture(this.texPartB);

        this.texPartA = this.createTexture(this.gl.RGBA32F, this.gl.RGBA, this.gl.FLOAT, this.particleTexDim, this.particleTexDim, initialData);
        this.texPartB = this.createTexture(this.gl.RGBA32F, this.gl.RGBA, this.gl.FLOAT, this.particleTexDim, this.particleTexDim, initialData);

        const indices = new Float32Array(count);
        for(let i=0; i<count; i++) indices[i] = i;
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.particleIndexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, indices, this.gl.STATIC_DRAW);
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

    createTexture(internalFormat, format, type, w, h, data = null) {
        const t = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, t);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, data);
        
        const glError = this.gl.getError();
        if (glError !== this.gl.NO_ERROR) {
            console.error(`WebGL Error in createTexture (IntFmt: ${internalFormat}, Fmt: ${format}, Type: ${type}): ${glError}`);
        }
        
        return t;
    }

    updateParticles(dt) {
        if(this.particleCount === 0) return;

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.particleFBO);
        this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.texPartB, 0);
        this.gl.viewport(0, 0, this.particleTexDim, this.particleTexDim);

        this.gl.useProgram(this.particleUpdateProgram);

        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texPartA);
        this.gl.uniform1i(this.particleUpdateUniforms.currPos, 0);

        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texUx);
        this.gl.uniform1i(this.particleUpdateUniforms.velX, 1);

        this.gl.activeTexture(this.gl.TEXTURE2);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texUy);
        this.gl.uniform1i(this.particleUpdateUniforms.velY, 2);

        this.gl.activeTexture(this.gl.TEXTURE3);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texObstacles);
        this.gl.uniform1i(this.particleUpdateUniforms.obstacles, 3);

        this.gl.uniform1f(this.particleUpdateUniforms.dt, dt);
        this.gl.uniform2f(this.particleUpdateUniforms.simDim, this.width, this.height);
        this.gl.uniform1f(this.particleUpdateUniforms.seed, Math.random() * 100.0);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        const positionLoc = this.gl.getAttribLocation(this.particleUpdateProgram, "a_position");
        this.gl.enableVertexAttribArray(positionLoc);
        this.gl.vertexAttribPointer(positionLoc, 2, this.gl.FLOAT, false, 0, 0);

        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

        let temp = this.texPartA;
        this.texPartA = this.texPartB;
        this.texPartB = temp;
    }

    draw(uxData, uyData, rhoData, barrierData, dyeData, tempData, vizParams) {
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

        this.gl.activeTexture(this.gl.TEXTURE4);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texDye);
        this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.gl.RED, this.gl.FLOAT, dyeData);
        this.gl.uniform1i(this.uniforms.dye, 4);

        this.gl.activeTexture(this.gl.TEXTURE5);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texTemperature);
        this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.gl.RED, this.gl.FLOAT, tempData);
        this.gl.uniform1i(this.uniforms.temperature, 5);

        this.gl.uniform1i(this.uniforms.mode, vizParams.mode);
        this.gl.uniform1f(this.uniforms.contrast, vizParams.contrast);
        this.gl.uniform1f(this.uniforms.brightness, vizParams.brightness);
        this.gl.uniform1f(this.uniforms.bias, vizParams.bias);
        this.gl.uniform1f(this.uniforms.power, vizParams.power);
        this.gl.uniform1i(this.uniforms.colorScheme, vizParams.colorScheme);

        const ocolor = vizParams.obstacleColor;
        const r_o = parseInt(ocolor.slice(1, 3), 16) / 255;
        const g_o = parseInt(ocolor.slice(3, 5), 16) / 255;
        const b_o = parseInt(ocolor.slice(5, 7), 16) / 255;
        this.gl.uniform3f(this.uniforms.obstacleColor, r_o, g_o, b_o);
        
        const bgcolor = vizParams.backgroundColor;
        const r_bg = parseInt(bgcolor.slice(1, 3), 16) / 255;
        const g_bg = parseInt(bgcolor.slice(3, 5), 16) / 255;
        const b_bg = parseInt(bgcolor.slice(5, 7), 16) / 255;
        this.gl.uniform3f(this.uniforms.backgroundColor, r_bg, g_bg, b_bg);
        
        this.gl.uniform1i(this.uniforms.vorticityBipolar, vizParams.vorticityBipolar);

        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    }

    drawParticles(params) {
        if(this.particleCount === 0) return;

        this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);

        this.gl.useProgram(this.particleRenderProgram);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.particleIndexBuffer);
        
        const posLoc = this.gl.getAttribLocation(this.particleRenderProgram, "a_index");
        this.gl.enableVertexAttribArray(posLoc);
        this.gl.vertexAttribPointer(posLoc, 1, this.gl.FLOAT, false, 0, 0);
        
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texPartA);
        this.gl.uniform1i(this.particleRenderUniforms.positions, 0);

        this.gl.uniform2f(this.particleRenderUniforms.resolution, this.width, this.height);
        this.gl.uniform1f(this.particleRenderUniforms.size, params.particles.size);
        
        const pcolor = params.particles.color;
        const r = parseInt(pcolor.slice(1, 3), 16) / 255;
        const g = parseInt(pcolor.slice(3, 5), 16) / 255;
        const b = parseInt(pcolor.slice(5, 7), 16) / 255;
        this.gl.uniform4f(this.particleRenderUniforms.color, r, g, b, params.particles.opacity);
        
        this.gl.drawArrays(this.gl.POINTS, 0, this.particleCount);
        
        this.gl.disable(this.gl.BLEND);
    }

    drawBrush(x, y, radius, color, angle, aspect, shape) {
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        this.gl.useProgram(this.brushProgram);

        this.gl.uniform2f(this.brushUniforms.resolution, this.gl.canvas.width, this.gl.canvas.height);
        this.gl.uniform2f(this.brushUniforms.center, x, y);
        this.gl.uniform1f(this.brushUniforms.radius, radius);
        this.gl.uniform4f(this.brushUniforms.color, color[0], color[1], color[2], color[3]);
        
        this.gl.uniform1f(this.brushUniforms.angle, angle);
        this.gl.uniform1f(this.brushUniforms.aspect, aspect);
        this.gl.uniform1i(this.brushUniforms.shape, shape);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.brushBuffer);
        const posLoc = this.gl.getAttribLocation(this.brushProgram, "a_position");
        this.gl.enableVertexAttribArray(posLoc);
        this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, 0, 0);

        this.gl.drawArrays(this.gl.TRIANGLES, 0, this.brushVertexCount);
        
        this.gl.disable(this.gl.BLEND);
    }
}