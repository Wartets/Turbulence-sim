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

        this.visPrograms = {
            vorticity: this.createProgram(VS_SOURCE, VORTICITY_VIS_FS),
            velocity: this.createProgram(VS_SOURCE, VELOCITY_VIS_FS),
            dye: this.createProgram(VS_SOURCE, DYE_VIS_FS),
            temperature: this.createProgram(VS_SOURCE, TEMPERATURE_VIS_FS),
            pressure: this.createProgram(VS_SOURCE, PRESSURE_VIS_FS)
        };
        this.modeMap = ['vorticity', 'velocity', 'dye', 'temperature', 'pressure'];

        this.particleRenderProgram = this.createProgram(PARTICLE_VS, PARTICLE_FS);
        this.particleUpdateProgram = this.createProgram(PARTICLE_UPDATE_VS, PARTICLE_UPDATE_FS);
        this.brushProgram = this.createProgram(BRUSH_VS, BRUSH_FS);
        this.postProgram = this.createProgram(POST_VS, POST_FS);
        this.vorticityProgram = this.createProgram(VS_SOURCE, VORTICITY_FS_SOURCE);
        
        this.texUx = this.createTexture(this.gl.R32F, this.gl.RED, this.gl.FLOAT, this.width, this.height);
        this.texUy = this.createTexture(this.gl.R32F, this.gl.RED, this.gl.FLOAT, this.width, this.height);
        this.texDye = this.createTexture(this.gl.R32F, this.gl.RED, this.gl.FLOAT, this.width, this.height);
        this.texObs = this.createTexture(this.gl.R8, this.gl.RED, this.gl.UNSIGNED_BYTE, this.width, this.height);
        this.texTemp = this.createTexture(this.gl.R32F, this.gl.RED, this.gl.FLOAT, this.width, this.height);
        this.texVorticity = this.createTexture(this.gl.R32F, this.gl.RED, this.gl.FLOAT, this.width, this.height);
        this.texRho = this.createTexture(this.gl.R32F, this.gl.RED, this.gl.FLOAT, this.width, this.height);

        this.quadBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1
        ]), this.gl.STATIC_DRAW);

        this.quadVAO = this.gl.createVertexArray();
        this.gl.bindVertexArray(this.quadVAO);
        this.gl.enableVertexAttribArray(0);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
        this.gl.bindVertexArray(null);

        this.particleIndexBuffer = this.gl.createBuffer();
        this.particleVAO = this.gl.createVertexArray();
        this.particleFBO = this.gl.createFramebuffer();
        this.vorticityFBO = this.gl.createFramebuffer();
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

        this.brushVAO = this.gl.createVertexArray();
        this.gl.bindVertexArray(this.brushVAO);
        this.gl.enableVertexAttribArray(0);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.brushBuffer);
        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
        this.gl.bindVertexArray(null);

        this.initPostProcessing();
        
        this.visUniforms = {};
        for (const key in this.visPrograms) {
            this.gl.useProgram(this.visPrograms[key]);
            this.visUniforms[key] = this._getVisUniformLocations(this.visPrograms[key]);
        }
        
        this.particleRenderUniforms = {
            positions: this.gl.getUniformLocation(this.particleRenderProgram, "u_positions"),
            resolution: this.gl.getUniformLocation(this.particleRenderProgram, "u_resolution"),
            size: this.gl.getUniformLocation(this.particleRenderProgram, "u_particle_size"),
            color: this.gl.getUniformLocation(this.particleRenderProgram, "u_particle_color")
        };

        this.particleUpdateUniforms = {
            currPos: this.gl.getUniformLocation(this.particleUpdateProgram, "u_curr_pos"),
            ux: this.gl.getUniformLocation(this.particleUpdateProgram, "u_ux"),
            uy: this.gl.getUniformLocation(this.particleUpdateProgram, "u_uy"),
            obs: this.gl.getUniformLocation(this.particleUpdateProgram, "u_obs"),
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
        
        this.postUniforms = {
            texture: this.gl.getUniformLocation(this.postProgram, "u_texture"),
            resolution: this.gl.getUniformLocation(this.postProgram, "u_resolution"),
            mode: this.gl.getUniformLocation(this.postProgram, "u_mode"),
            radius: this.gl.getUniformLocation(this.postProgram, "u_radius"),
            intensity: this.gl.getUniformLocation(this.postProgram, "u_intensity")
        };

        this.vorticityUniforms = {
            ux: this.gl.getUniformLocation(this.vorticityProgram, "u_ux"),
            uy: this.gl.getUniformLocation(this.vorticityProgram, "u_uy")
        };
    }

    _getVisUniformLocations(program) {
        return {
            ux: this.gl.getUniformLocation(program, "u_ux"),
            uy: this.gl.getUniformLocation(program, "u_uy"),
            rho: this.gl.getUniformLocation(program, "u_rho"),
            dye: this.gl.getUniformLocation(program, "u_dye"),
            obs: this.gl.getUniformLocation(program, "u_obs"),
            temp: this.gl.getUniformLocation(program, "u_temp"),
            vorticity: this.gl.getUniformLocation(program, "u_vorticity"),
            contrast: this.gl.getUniformLocation(program, "u_contrast"),
            brightness: this.gl.getUniformLocation(program, "u_brightness"),
            bias: this.gl.getUniformLocation(program, "u_bias"),
            power: this.gl.getUniformLocation(program, "u_power"),
            colorScheme: this.gl.getUniformLocation(program, "u_color_scheme"),
            obstacleColor: this.gl.getUniformLocation(program, "u_obstacle_color"),
            backgroundColor: this.gl.getUniformLocation(program, "u_background_color"),
            vorticityBipolar: this.gl.getUniformLocation(program, "u_vorticity_bipolar")
        };
    }

    runVorticityPass() {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.vorticityFBO);
        this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.texVorticity, 0);
        this.gl.viewport(0, 0, this.width, this.height);

        this.gl.useProgram(this.vorticityProgram);
        this.gl.bindVertexArray(this.quadVAO);

        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texUx);
        this.gl.uniform1i(this.vorticityUniforms.ux, 0);

        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texUy);
        this.gl.uniform1i(this.vorticityUniforms.uy, 1);

        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

        this.gl.bindVertexArray(null);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
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

        this.gl.bindVertexArray(this.particleVAO);
        this.gl.enableVertexAttribArray(0);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.particleIndexBuffer);
        this.gl.vertexAttribPointer(0, 1, this.gl.FLOAT, false, 0, 0);
        this.gl.bindVertexArray(null);
    }

    initPostProcessing() {
        this.postFBO = this.gl.createFramebuffer();
        this.postTex = this.gl.createTexture();
        
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.postTex);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.canvas.width, this.gl.canvas.height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.postFBO);
        this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.postTex, 0);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
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

    updateParticles(dt, physicsParams) {
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
        this.gl.uniform1i(this.particleUpdateUniforms.ux, 1);

        this.gl.activeTexture(this.gl.TEXTURE2);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texUy);
        this.gl.uniform1i(this.particleUpdateUniforms.uy, 2);

        this.gl.activeTexture(this.gl.TEXTURE3);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texObs);
        this.gl.uniform1i(this.particleUpdateUniforms.obs, 3);

        this.gl.uniform1f(this.particleUpdateUniforms.dt, dt);
        this.gl.uniform2f(this.particleUpdateUniforms.simDim, this.width, this.height);
        this.gl.uniform1f(this.particleUpdateUniforms.seed, Math.random() * 100.0);
        this.gl.uniform4f(this.particleUpdateUniforms.boundaries,
            physicsParams.boundaryLeft,
            physicsParams.boundaryRight,
            physicsParams.boundaryBottom,
            physicsParams.boundaryTop
        );

        this.gl.bindVertexArray(this.quadVAO);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
        this.gl.bindVertexArray(null);

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

        let temp = this.texPartA;
        this.texPartA = this.texPartB;
        this.texPartB = temp;
    }

    draw(views, vizParams, postParams, obsDirty) {
        if (vizParams.mode === 0 && (views.ux || views.uy)) {
            this.runVorticityPass();
        }

        const usePost = postParams && postParams.enabled;
        
        if (usePost) {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.postFBO);
            this.gl.clearColor(0, 0, 0, 1);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        } else {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        }

        this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
        this.gl.disable(this.gl.BLEND);
        
        const modeKey = this.modeMap[vizParams.mode];
        const program = this.visPrograms[modeKey];
        const uniforms = this.visUniforms[modeKey];
        
        this.gl.useProgram(program);
        this.gl.bindVertexArray(this.quadVAO);

        if (views.ux) {
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texUx);
            this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.gl.RED, this.gl.FLOAT, views.ux);
        }
        if (views.uy) {
            this.gl.activeTexture(this.gl.TEXTURE1);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texUy);
            this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.gl.RED, this.gl.FLOAT, views.uy);
        }
        if (views.density) { 
            this.gl.activeTexture(this.gl.TEXTURE2);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texRho);
            this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.gl.RED, this.gl.FLOAT, views.density);
        }
        if (views.dye) {
            this.gl.activeTexture(this.gl.TEXTURE3);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texDye);
            this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.gl.RED, this.gl.FLOAT, views.dye);
        }
        if (views.obs) {
            this.gl.activeTexture(this.gl.TEXTURE4);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texObs);
            this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.gl.RED, this.gl.UNSIGNED_BYTE, views.obs);
        }
        if (views.temp) {
            this.gl.activeTexture(this.gl.TEXTURE5);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texTemp);
            this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.gl.RED, this.gl.FLOAT, views.temp);
        }

        if (uniforms.ux) {
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texUx);
            this.gl.uniform1i(uniforms.ux, 0);
        }
        if (uniforms.uy) {
            this.gl.activeTexture(this.gl.TEXTURE1);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texUy);
            this.gl.uniform1i(uniforms.uy, 1);
        }
        if (uniforms.rho) {
            this.gl.activeTexture(this.gl.TEXTURE2);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texRho); 
            this.gl.uniform1i(uniforms.rho, 2);
        }
        if (uniforms.dye) {
            this.gl.activeTexture(this.gl.TEXTURE3);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texDye);
            this.gl.uniform1i(uniforms.dye, 3);
        }
        if (uniforms.obs) {
            this.gl.activeTexture(this.gl.TEXTURE4);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texObs);
            this.gl.uniform1i(uniforms.obs, 4);
        }
        if (uniforms.temp) {
            this.gl.activeTexture(this.gl.TEXTURE5);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texTemp);
            this.gl.uniform1i(uniforms.temp, 5);
        }
        if (uniforms.vorticity) {
            this.gl.activeTexture(this.gl.TEXTURE6);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texVorticity);
            this.gl.uniform1i(uniforms.vorticity, 6);
        }

        this.gl.uniform1f(uniforms.contrast, vizParams.contrast);
        this.gl.uniform1f(uniforms.brightness, vizParams.brightness);
        this.gl.uniform1f(uniforms.bias, vizParams.bias);
        this.gl.uniform1f(uniforms.power, vizParams.power);
        this.gl.uniform1i(uniforms.colorScheme, vizParams.colorScheme);

        const ocolor = vizParams.obstacleColor;
        const r_o = parseInt(ocolor.slice(1, 3), 16) / 255;
        const g_o = parseInt(ocolor.slice(3, 5), 16) / 255;
        const b_o = parseInt(ocolor.slice(5, 7), 16) / 255;
        this.gl.uniform3f(uniforms.obstacleColor, r_o, g_o, b_o);
        
        const bgcolor = vizParams.backgroundColor;
        const r_bg = parseInt(bgcolor.slice(1, 3), 16) / 255;
        const g_bg = parseInt(bgcolor.slice(3, 5), 16) / 255;
        const b_bg = parseInt(bgcolor.slice(5, 7), 16) / 255;
        this.gl.uniform3f(uniforms.backgroundColor, r_bg, g_bg, b_bg);
        
        if (uniforms.vorticityBipolar) {
            this.gl.uniform1i(uniforms.vorticityBipolar, vizParams.vorticityBipolar);
        }

        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
        this.gl.bindVertexArray(null);

        if (vizParams.particles && vizParams.particles.show) {
            this.drawParticles(vizParams); 
        }

        if (usePost) {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
            this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
            this.gl.disable(this.gl.BLEND);
            
            this.gl.useProgram(this.postProgram);
            
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.postTex);
            this.gl.uniform1i(this.postUniforms.texture, 0);
            
            this.gl.uniform2f(this.postUniforms.resolution, this.gl.canvas.width, this.gl.canvas.height);
            
            let modeIdx = 0;
            if (postParams.mode === 'Gaussian Blur') modeIdx = 1;
            else if (postParams.mode === 'Edge Detect') modeIdx = 2;
            else if (postParams.mode === 'Sharpen') modeIdx = 3;
            
            this.gl.uniform1i(this.postUniforms.mode, modeIdx);
            this.gl.uniform1f(this.postUniforms.radius, postParams.radius);
            this.gl.uniform1f(this.postUniforms.intensity, postParams.intensity);
            
            this.gl.bindVertexArray(this.quadVAO);
            this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
            this.gl.bindVertexArray(null);
        }
    }

    drawParticles(params) {
        if(this.particleCount === 0) return;

        this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);

        this.gl.useProgram(this.particleRenderProgram);
        this.gl.bindVertexArray(this.particleVAO);
        
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
        this.gl.bindVertexArray(null);
        
        this.gl.disable(this.gl.BLEND);
    }

    drawBrush(x, y, radius, color, angle, aspect, shape) {
        this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
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

        this.gl.bindVertexArray(this.brushVAO);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, this.brushVertexCount);
        this.gl.bindVertexArray(null);
        
        this.gl.disable(this.gl.BLEND);
    }
}