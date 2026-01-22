createFluidEngine().then(Module => {
    const canvas = document.getElementById('simCanvas');
    let engine = null;
    let renderer = null;
    let requestId = null;
    const fpsCounter = document.getElementById('fps-counter');
    let lastTime = 0;
    let frameCount = 0;
    
    let presetsData = {};
    let wallVC = {};
    let inflowC = {};
    let inflowFolder, wallFolder;

    const params = {
        preset: 'Default',
        simulation: {
            resolutionScale: 300,
            iterations: 2,
            paused: false,
            dt: 0.1,
            threads: navigator.hardwareConcurrency || 4
        },

        physics: {
            viscosity: 0.8,
            decay: 0.001,
            globalDrag: 0.0,
            boundaryLeft: 1,
            boundaryRight: 1,
            boundaryTop: 1,
            boundaryBottom: 1,
            inflowVelocityX: 0.1,
            inflowVelocityY: 0.0,
            inflowDensity: 1.0,
            movingWallVelocityLeft: 0.0,
            movingWallVelocityRight: 0.0,
            movingWallVelocityTop: 0.1,
            movingWallVelocityBottom: 0.0,
            gravityX: 0,
            gravityY: 0,
            thermalExpansion: 0.1,
            referenceTemperature: 0.0,
            thermalDiffusivity: 0.001,
            vorticityConfinement: 0.1,
            maxVelocity: 0.57,
            smagorinsky: 0.05,
            tempViscosity: 0.0,
            rheologyIndex: 1.0,
            rheologyConsistency: 0.0,
            porosityDrag: 0.5,
            spongeStrength: 0.05,
            spongeWidth: 20,
        },

        features: {
            enableGravity: false,
            enableBuoyancy: false,
            enableVorticity: true,
            enableSmagorinsky: true,
            enableTempViscosity: false,
            enableNonNewtonian: false,
            enableBFECC: true,
            spongeLeft: false,
            spongeRight: false,
            spongeTop: false,
            spongeBottom: false,
        },
        
        visualization: {
            mode: 1, 
            colorScheme: 4, 
            contrast: 1,
            brightness: 1,
            bias: 0,
            power: 1,
            obstacleColor: '#4d4d4d',
            backgroundColor: '#00020A',
            vorticityBipolar: false,
        },
        
        particles: {
            show: false,
            count: 700000,
            size: 0.05,
            opacity: 0.22,
            color: '#ffffff',
        },

        postProcessing: {
            enabled: false,
            mode: 'Gaussian Blur',
            radius: 2.0,
            intensity: 1.0
        },

        brush: {
            type: 'combined',
            size: 10,
            falloff: 0.26,
            gaussianFalloff: 2.0,
            shape: 'Circle',
            falloffType: 'Smooth',
            angle: 0.0,
            aspectRatio: 1.0,
            vortexDirection: 1,
            erase: false,
            velocityStrength: 1.7,
            densityStrength: 0.7,
            temperatureStrength: 4.0,
            noiseStrength: 0.9,
            dragStrength: 0.2,
            expansionStrength: 1.0,
            porosityStrength: 0.05,
        },

        reset: () => { 
            if(engine) engine.reset(); 
            if(renderer) renderer.initParticles(params.particles.count);
        }
    };

    const updateGravity = () => {
        if (!engine) return;
        if (params.features.enableGravity) {
            engine.setGravity(params.physics.gravityX, params.physics.gravityY);
        } else {
            engine.setGravity(0, 0);
        }
    };

    const updateBuoyancy = () => {
        if (!engine) return;
        if (params.features.enableBuoyancy) {
            engine.setThermalProperties(params.physics.thermalExpansion, params.physics.referenceTemperature);
        } else {
            engine.setThermalProperties(0, 0);
        }
    };

    const updateVorticity = () => {
        if (!engine) return;
        engine.setVorticityConfinement(params.features.enableVorticity ? params.physics.vorticityConfinement : 0);
    };

    const updateSmagorinsky = () => {
        if (!engine) return;
        engine.setSmagorinskyConstant(params.features.enableSmagorinsky ? params.physics.smagorinsky : 0.0);
    };

    const updateTempViscosity = () => {
        if (!engine) return;
        engine.setTemperatureViscosity(params.features.enableTempViscosity ? params.physics.tempViscosity : 0.0);
    };

    const updateRheology = () => {
        if (!engine) return;
        if (params.features.enableNonNewtonian) {
            engine.setFlowBehaviorIndex(params.physics.rheologyIndex);
            engine.setConsistencyIndex(params.physics.rheologyConsistency);
        } else {
            engine.setConsistencyIndex(0.0);
        }
    };

    const updateBoundaryControls = () => {
        const bLeft = parseInt(params.physics.boundaryLeft);
        const bRight = parseInt(params.physics.boundaryRight);
        const bTop = parseInt(params.physics.boundaryTop);
        const bBottom = parseInt(params.physics.boundaryBottom);

        const needsInflow = bLeft === 4 || bRight === 4 || bTop === 4 || bBottom === 4;
        inflowFolder.show(needsInflow);

        const isLeftMoving = bLeft === 3;
        const isRightMoving = bRight === 3;
        const isTopMoving = bTop === 3;
        const isBottomMoving = bBottom === 3;

        const needsWall = isLeftMoving || isRightMoving || isTopMoving || isBottomMoving;
        wallFolder.show(needsWall);

        if (wallVC.left) wallVC.left.show(isLeftMoving);
        if (wallVC.right) wallVC.right.show(isRightMoving);
        if (wallVC.top) wallVC.top.show(isTopMoving);
        if (wallVC.bottom) wallVC.bottom.show(isBottomMoving);
    };

    const updateBoundaries = () => {
        if (!engine) return;
        engine.setBoundaryConditions(
            parseInt(params.physics.boundaryLeft),
            parseInt(params.physics.boundaryRight),
            parseInt(params.physics.boundaryTop),
            parseInt(params.physics.boundaryBottom)
        );
        updateBoundaryControls();
    };
    
    const updateSponge = () => {
        if (!engine) return;
        engine.setSpongeProperties(params.physics.spongeStrength, params.physics.spongeWidth);
        engine.setSpongeBoundaries(
            params.features.spongeLeft,
            params.features.spongeRight,
            params.features.spongeTop,
            params.features.spongeBottom
        );
    };
    
    const updateWall = (side, value) => {
        if(!engine) return;
        if(side === 'Top' || side === 'Bottom') engine.setMovingWallVelocity(side === 'Top' ? 2 : 3, value, 0);
        else engine.setMovingWallVelocity(side === 'Left' ? 0 : 1, 0, value);
    };

    const updateBFECC = () => {
        if (!engine) return;
        engine.setBFECC(params.features.enableBFECC);
    };

    const gui = new lil.GUI({ title: 'Turbulence Simulation' });

    const findController = (root, obj, property) => {
        let found = null;
        const traverse = (node) => {
            if (found) return;
            if (node.controllers) {
                for (let c of node.controllers) {
                    if (c.object === obj && c.property === property) {
                        found = c;
                        return;
                    }
                }
            }
            if (node.folders) {
                for (let f of node.folders) traverse(f);
            }
        };
        traverse(root);
        return found;
    };

    const applyPresetDeep = (targetObj, sourceObj) => {
        for (const key in sourceObj) {
            if (typeof sourceObj[key] === 'object' && sourceObj[key] !== null && !Array.isArray(sourceObj[key])) {
                applyPresetDeep(targetObj[key], sourceObj[key]);
            } else {
                const controller = findController(gui, targetObj, key);
                if (controller) {
                    controller.setValue(sourceObj[key]);
                } else {
                    targetObj[key] = sourceObj[key];
                }
            }
        }
    };

    fetch('presets.json')
        .then(response => response.json())
        .then(data => {
            presetsData = data;
            const presetNames = Object.keys(data);
            const presetFolder = gui.addFolder('Presets').close();
            presetFolder.add(params, 'preset', presetNames).name('Select Preset').onChange(name => {
                if (presetsData[name]) {
                    applyPresetDeep(params, presetsData[name]);
                }
            });
            presetFolder.open();
        })
        .catch(err => console.error('Failed to load presets:', err));

    const simFolder = gui.addFolder('Simulation').close();
    simFolder.add(params.simulation, 'resolutionScale', [50, 100, 200, 300, 400, 600, 800, 1000]).name('Grid Resolution').onChange(initSimulation);
    simFolder.add(params.simulation, 'iterations', 0, 20, 1).name('Iterations/Frame');
    simFolder.add(params.simulation, 'dt', 0.001, 1.5, 0.001).name('Time Step (dt)').step(0.01).onChange(t => engine && engine.setDt(t));
    simFolder.add(params.simulation, 'threads', 1, 32, 1).name('CPU Threads').onChange(t => {
        if (engine && typeof engine.setThreadCount === 'function') {
            engine.setThreadCount(t);
        }
    });
    simFolder.add(params.simulation, 'paused').name('Pause').listen();

    const physicsFolder = gui.addFolder('Physics');
    
    physicsFolder.add(params, 'reset').name('Reset Fluid');

    physicsFolder.add(params.physics, 'viscosity', 0.001, 10).name('Viscosity').step(0.001).onChange(v => engine && engine.setViscosity(v));
    physicsFolder.add(params.physics, 'decay', 0.0, 0.05).name('Dye Dissipation').step(0.0001).onChange(d => engine && engine.setDecay(d));
    physicsFolder.add(params.physics, 'globalDrag', 0.0, 0.1).name('Global Drag').step(0.0001).onChange(d => engine && engine.setGlobalDrag(d));
    const boundaryTypes = {
        'Periodic': 0,
        'No-Slip Wall': 1,
        'Free-Slip Wall': 2,
        'Moving Wall': 3,
        'Inflow': 4,
        'Outflow': 5
    };

    const boundaryFolder = physicsFolder.addFolder('Boundaries').close();
    
    boundaryFolder.add(params.physics, 'boundaryLeft', boundaryTypes).name('Left').onChange(updateBoundaries);
    boundaryFolder.add(params.physics, 'boundaryRight', boundaryTypes).name('Right').onChange(updateBoundaries);
    boundaryFolder.add(params.physics, 'boundaryTop', boundaryTypes).name('Top').onChange(updateBoundaries);
    boundaryFolder.add(params.physics, 'boundaryBottom', boundaryTypes).name('Bottom').onChange(updateBoundaries);

    inflowFolder = boundaryFolder.addFolder('Inflow Properties');
    const updateInflow = () => engine && engine.setInflowProperties(params.physics.inflowVelocityX, params.physics.inflowVelocityY, params.physics.inflowDensity);
    inflowC.vx = inflowFolder.add(params.physics, 'inflowVelocityX', -0.5, 0.5).name('Velocity X').step(0.01).onChange(updateInflow);
    inflowC.vy = inflowFolder.add(params.physics, 'inflowVelocityY', -0.5, 0.5).name('Velocity Y').step(0.01).onChange(updateInflow);
    inflowC.rho = inflowFolder.add(params.physics, 'inflowDensity', 0.1, 5.0).name('Density').onChange(updateInflow);

    wallFolder = boundaryFolder.addFolder('Moving Wall Velocity');
    wallVC.left = wallFolder.add(params.physics, 'movingWallVelocityLeft', -0.5, 0.5).name('Left Wall (vy)').step(0.01).onChange(v => updateWall('Left', v));
    wallVC.right = wallFolder.add(params.physics, 'movingWallVelocityRight', -0.5, 0.5).name('Right Wall (vy)').step(0.01).onChange(v => updateWall('Right', v));
    wallVC.top = wallFolder.add(params.physics, 'movingWallVelocityTop', -0.5, 0.5).name('Top Wall (vx)').step(0.01).onChange(v => updateWall('Top', v));
    wallVC.bottom = wallFolder.add(params.physics, 'movingWallVelocityBottom', -0.5, 0.5).name('Bottom Wall (vx)').step(0.01).onChange(v => updateWall('Bottom', v));
    
    const spongeFolder = boundaryFolder.addFolder('Sponge Zones (Absorbing)');
    spongeFolder.add(params.physics, 'spongeStrength', 0, 1.0).name('Strength').step(0.001).onChange(updateSponge);
    spongeFolder.add(params.physics, 'spongeWidth', 0, 100, 1).name('Width (cells)').onChange(updateSponge);
    spongeFolder.add(params.features, 'spongeLeft').name('Enable Left').onChange(updateSponge);
    spongeFolder.add(params.features, 'spongeRight').name('Enable Right').onChange(updateSponge);
    spongeFolder.add(params.features, 'spongeTop').name('Enable Top').onChange(updateSponge);
    spongeFolder.add(params.features, 'spongeBottom').name('Enable Bottom').onChange(updateSponge);

    const advancedPhysicsFolder = physicsFolder.addFolder('Advanced').close();
    advancedPhysicsFolder.add(params.physics, 'maxVelocity', 0.01, 1.0).name('Max Velocity (Stability)').step(0.01).onChange(v => engine && engine.setMaxVelocity(v));
    advancedPhysicsFolder.add(params.features, 'enableBFECC').name('Enable BFECC').onChange(updateBFECC);
    
    const turbulenceFolder = physicsFolder.addFolder('Turbulence (LES)').close();
    const smagController = turbulenceFolder.add(params.physics, 'smagorinsky', 0.0, 0.3).name('Smagorinsky Const').step(0.01).onChange(updateSmagorinsky);
    turbulenceFolder.add(params.features, 'enableSmagorinsky').name('Enable LES').onChange(enabled => {
        smagController.enable(enabled);
        updateSmagorinsky();
    });

    const thermodynamicsFolder = physicsFolder.addFolder('Thermodynamics').close();
    const tempViscController = thermodynamicsFolder.add(params.physics, 'tempViscosity', 0.0, 5.0).name('Heat Thins Fluid').step(0.1).onChange(updateTempViscosity);
    thermodynamicsFolder.add(params.features, 'enableTempViscosity').name('Link Viscosity').onChange(enabled => {
        tempViscController.enable(enabled);
        updateTempViscosity();
    });

    const gravityFolder = physicsFolder.addFolder('Gravity').close();
    const gravityXController = gravityFolder.add(params.physics, 'gravityX', -4, 4).name('X Component').step(0.01).onChange(updateGravity);
    const gravityYController = gravityFolder.add(params.physics, 'gravityY', -4, 4).name('Y Component').step(0.01).onChange(updateGravity);
    gravityFolder.add(params.features, 'enableGravity').name('Enable').onChange(enabled => {
        gravityXController.enable(enabled);
        gravityYController.enable(enabled);
        updateGravity();
    });

    const vorticityFolder = physicsFolder.addFolder('Vorticity').close();
    const vorticityController = vorticityFolder.add(params.physics, 'vorticityConfinement', 0, 1.0).name('Strength').step(0.01).onChange(updateVorticity);
    vorticityFolder.add(params.features, 'enableVorticity').name('Enable').onChange(enabled => {
        vorticityController.enable(enabled);
        updateVorticity();
    });

    const thermoBuoyancyFolder = physicsFolder.addFolder('Buoyancy (Boussinesq)').close();
    const expansionController = thermoBuoyancyFolder.add(params.physics, 'thermalExpansion', -1.0, 1.0).name('Thermal Expansion').step(0.001).onChange(updateBuoyancy);
    const refTempController = thermoBuoyancyFolder.add(params.physics, 'referenceTemperature', -10.0, 10.0).name('Reference Temp').step(0.1).onChange(updateBuoyancy);
    thermoBuoyancyFolder.add(params.physics, 'thermalDiffusivity', 0.0, 0.05).name('Diffusivity').step(0.0001).onChange(d => engine && engine.setThermalDiffusivity(d));
    thermoBuoyancyFolder.add(params.features, 'enableBuoyancy').name('Enable').onChange(enabled => {
        expansionController.enable(enabled);
        refTempController.enable(enabled);
        updateBuoyancy();
    });

    const rheologyFolder = physicsFolder.addFolder('Rheology (Non-Newtonian)').close();
    rheologyFolder.add(params.features, 'enableNonNewtonian').name('Enable').onChange(updateRheology);
    rheologyFolder.add(params.physics, 'rheologyIndex', 0.1, 2.0).name('Flow Index (n)').step(0.01).onChange(updateRheology);
    rheologyFolder.add(params.physics, 'rheologyConsistency', 0.0, 5.0).name('Consistency (k)').step(0.01).onChange(updateRheology);

    const porousFolder = physicsFolder.addFolder('Porous Media').close();
    porousFolder.add(params.physics, 'porosityDrag', 0, 2.0).name('Drag Coefficient').step(0.01).onChange(d => engine.setPorosityDrag(d));

    const viewFolder = gui.addFolder('Visualization');
    viewFolder.add(params.visualization, 'mode', { 'Vorticity': 0, 'Velocity': 1, 'Density': 2, 'Temperature': 3, 'Pressure': 4 }).name('Field');
    viewFolder.add(params.visualization, 'colorScheme', { 
        'Inferno': 0, 'Magma': 1, 'Plasma': 2, 'Viridis': 3,
        'Turbo': 4, 'Grayscale': 5, 'Ice': 6, 'Cividis': 7, 'Coolwarm': 8
    }).name('Palette');
    viewFolder.add(params.visualization, 'contrast', 0.1, 5.0).name('Contrast / Gain').step(0.05);
    viewFolder.add(params.visualization, 'brightness', 0.1, 2.0).name('Brightness').step(0.05);
    viewFolder.add(params.visualization, 'bias', -1.0, 1.0).name('Bias / Offset').step(0.001).listen();
    viewFolder.add(params.visualization, 'power', 0.01, 5.0).name('Gamma / Power').step(0.01);
    viewFolder.addColor(params.visualization, 'obstacleColor').name('Obstacle Color');
    viewFolder.addColor(params.visualization, 'backgroundColor').name('Background Color');
    viewFolder.add(params.visualization, 'vorticityBipolar').name('Bipolar Map');
    
    const particleFolder = viewFolder.addFolder('Particles').close();
    particleFolder.add(params.particles, 'show').name('Show Particles').listen();
    particleFolder.add(params.particles, 'count', 0, 1000000, 10000).name('Particle Count').onChange(count => {
        if(renderer) renderer.initParticles(count);
    });
    particleFolder.add(params.particles, 'size', 0.001, 0.2).name('Size');
    particleFolder.add(params.particles, 'opacity', 0.0, 1.0).name('Opacity');
    particleFolder.addColor(params.particles, 'color').name('Color');

    const ppFolder = gui.addFolder('Post Processing').close();
    ppFolder.add(params.postProcessing, 'enabled').name('Enable Filter');
    ppFolder.add(params.postProcessing, 'mode', ['Gaussian Blur', 'Edge Detect', 'Sharpen']).name('Filter Type');
    ppFolder.add(params.postProcessing, 'radius', 0.0, 50).name('Radius');
    ppFolder.add(params.postProcessing, 'intensity', 0.0, 10).name('Intensity');

    const inputFolder = gui.addFolder('Interaction');
    const brushTypeController = inputFolder.add(params.brush, 'type', ['none', 'combined', 'velocity', 'density', 'temperature', 'vortex', 'expansion', 'noise', 'drag', 'obstacle', 'porosity']).name('Brush Mode');
    inputFolder.add(params.brush, 'size', 1, 100).name('Radius');
    inputFolder.add(params.brush, 'shape', ['Circle', 'Square', 'Diamond']).name('Shape');
    const falloffTypeController = inputFolder.add(params.brush, 'falloffType', ['Smooth', 'Gaussian']).name('Falloff Type');
    inputFolder.add(params.brush, 'angle', 0, 360).name('Angle (Deg)');
    inputFolder.add(params.brush, 'aspectRatio', 0.01, 4.0).name('Aspect Ratio');
    const velocityStrengthController = inputFolder.add(params.brush, 'velocityStrength', 0.01, 10.0).name('Velocity Strength').step(0.01);
    const densityStrengthController = inputFolder.add(params.brush, 'densityStrength', 0.01, 10.0).name('Density Strength').step(0.01);
    const temperatureStrengthController = inputFolder.add(params.brush, 'temperatureStrength', 0.01, 20.0).name('Temperature Strength').step(0.01);
    const noiseStrengthController = inputFolder.add(params.brush, 'noiseStrength', 0.01, 10.0).name('Noise Strength').step(0.01);
    const expansionStrengthController = inputFolder.add(params.brush, 'expansionStrength', -5.0, 5.0).name('Expansion Strength').step(0.01);
    const dragStrengthController = inputFolder.add(params.brush, 'dragStrength', 0.0, 1.0).name('Drag Factor').step(0.01);
    const porosityStrengthController = inputFolder.add(params.brush, 'porosityStrength', 0.0, 1.0).name('Porosity Strength').step(0.01);

    const falloffController = inputFolder.add(params.brush, 'falloff', 0, 1).name('Edge Falloff').step(0.01);
    const gaussianFalloffController = inputFolder.add(params.brush, 'gaussianFalloff', 0.1, 100.0).name('Gaussian Falloff').step(0.1);
    const eraseController = inputFolder.add(params.brush, 'erase').name('Eraser');
    const vortexController = inputFolder.add(params.brush, 'vortexDirection', { 'Counter-Clockwise': 1, 'Clockwise': -1 }).name('Vortex Direction');

    const updateBrushUI = () => {
        const type = params.brush.type;
        const falloffType = params.brush.falloffType;

        const isNone = type === 'none';
        const isObstacle = type === 'obstacle';
        const isVortex = type === 'vortex';
        const isExpansion = type === 'expansion';
        const isNoise = type === 'noise';
        const isDrag = type === 'drag';
        const isPorosity = type === 'porosity';
        
        const isVelocity = type === 'velocity' || type === 'combined';
        const isDensity = type === 'density' || type === 'combined';
        const isTemperature = type === 'temperature' || type === 'combined';

        velocityStrengthController.show(!isNone && (isVelocity || isVortex));
        if(isVortex) velocityStrengthController.name('Vortex Strength');
        else velocityStrengthController.name('Velocity Strength');

        densityStrengthController.show(!isNone && isDensity);
        temperatureStrengthController.show(!isNone && isTemperature);
        
        noiseStrengthController.show(!isNone && isNoise);
        expansionStrengthController.show(!isNone && isExpansion);
        dragStrengthController.show(!isNone && isDrag);

        const isGaussian = falloffType === 'Gaussian';
        falloffController.show(!isNone && !isObstacle && !isGaussian);
        gaussianFalloffController.show(!isNone && !isObstacle && isGaussian);
        
        porosityStrengthController.show(!isNone && isPorosity);

        vortexController.show(!isNone && isVortex);
        eraseController.show(!isNone);

        if (isObstacle) {
            eraseController.name('Remove Obstacle');
        } else if (isPorosity) {
            eraseController.name('Decrease Porosity');
        } else {
            eraseController.name('Eraser');
        }
    };
    brushTypeController.onChange(updateBrushUI);
    falloffTypeController.onChange(updateBrushUI);

    let simWidth, simHeight;
    
    let uploadedVersions = {
        ux: 0,
        uy: 0,
        dye: 0,
        temp: 0,
        density: 0
    };

    function initSimulation() {
        if (requestId) cancelAnimationFrame(requestId);
        if (engine) engine.delete();

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const aspect = canvas.width / canvas.height;
        const baseRes = parseInt(params.simulation.resolutionScale);
        
        simHeight = baseRes;
        simWidth = Math.round(baseRes * aspect);

        engine = new Module.FluidEngine(simWidth, simHeight);
        
        uploadedVersions = {
            ux: 0,
            uy: 0,
            dye: 0,
            temp: 0,
            density: 0
        };
        
        console.log("FluidEngine instance created.");
        if (engine) {
            const proto = Object.getPrototypeOf(engine);
            const methods = Object.getOwnPropertyNames(proto);
            console.log("Available methods on FluidEngine:", methods.join(", "));
        }

        engine.setViscosity(params.physics.viscosity);
        engine.setDecay(params.physics.decay);
        engine.setGlobalDrag(params.physics.globalDrag);
        engine.setDt(params.simulation.dt);
        updateBoundaries();
        updateInflow();
        updateWall('Left', params.physics.movingWallVelocityLeft);
        updateWall('Right', params.physics.movingWallVelocityRight);
        updateWall('Top', params.physics.movingWallVelocityTop);
        updateWall('Bottom', params.physics.movingWallVelocityBottom);
        engine.setThermalDiffusivity(params.physics.thermalDiffusivity);
        engine.setMaxVelocity(params.physics.maxVelocity);
        engine.setPorosityDrag(params.physics.porosityDrag);
        updateSponge();
        
        if (typeof engine.setThreadCount === 'function') {
            engine.setThreadCount(params.simulation.threads);
            console.log("Thread count set to " + params.simulation.threads);
        } else {
            console.warn("setThreadCount not available in FluidEngine module. Check console logs for available methods.");
        }
        
        updateGravity();
        updateBuoyancy();
        updateVorticity();
        updateRheology();
        updateSmagorinsky();
        updateTempViscosity();
        updateBFECC();
        
        renderer = new Renderer(canvas, simWidth, simHeight);
        renderer.initParticles(params.particles.count);

        updateBoundaryControls();
        updateBrushUI();
        loop();
    }

    let mouse = {
        x: 0, y: 0,
        lastClientX: 0, lastClientY: 0,
        isDragging: false,
        isOver: false
    };

    const handleInput = (clientX, clientY) => {
        if (params.brush.type === 'none') return;

        const rect = canvas.getBoundingClientRect();

        const toSimCoords = (cx, cy) => {
            const mx = cx - rect.left;
            const my = cy - rect.top;
            return {
                x: Math.min(simWidth - 1, Math.max(0, Math.floor((mx / canvas.width) * simWidth))),
                y: Math.min(simHeight - 1, Math.max(0, Math.floor(((canvas.height - my) / canvas.height) * simHeight)))
            };
        };

        const currentPos = toSimCoords(clientX, clientY);
        const prevPos = toSimCoords(mouse.lastClientX, mouse.lastClientY);

        const dx = (clientX - mouse.lastClientX);
        const dy = -(clientY - mouse.lastClientY); 

        const dist = Math.hypot(currentPos.x - prevPos.x, currentPos.y - prevPos.y);
        
        const steps = Math.ceil(dist) || 1;

        const brush = params.brush;
        const radius = Math.round(brush.size);
        
        let shapeInt = 0;
        if (brush.shape === 'Square') shapeInt = 1;
        if (brush.shape === 'Diamond') shapeInt = 2;
        
        let falloffInt = (brush.falloffType === 'Gaussian') ? 1 : 0;
        let currentFalloff = (brush.falloffType === 'Gaussian') ? brush.gaussianFalloff : brush.falloff;
        
        for (let i = 0; i < steps; i++) {
            const t = (i + 1) / steps;
            
            const simX = Math.round(prevPos.x + (currentPos.x - prevPos.x) * t);
            const simY = Math.round(prevPos.y + (currentPos.y - prevPos.y) * t);

            if (brush.type === 'obstacle') {
                 engine.addObstacle(simX, simY, radius, brush.erase, brush.angle, brush.aspectRatio, shapeInt);
            } else {
                if (brush.erase) {
                    engine.clearRegion(simX, simY, radius);
                } else {
                    if (brush.type === 'porosity') {
                        engine.applyPorosityBrush(simX, simY, radius, brush.porosityStrength, !brush.erase, currentFalloff, brush.angle, brush.aspectRatio, shapeInt, falloffInt);
                    } else if (brush.type === 'vortex') {
                        const str = brush.velocityStrength * brush.vortexDirection;
                        engine.applyDimensionalBrush(simX, simY, radius, 0, str, currentFalloff, brush.angle, brush.aspectRatio, shapeInt, falloffInt);
                    } else if (brush.type === 'expansion') {
                        engine.applyDimensionalBrush(simX, simY, radius, 1, brush.expansionStrength, currentFalloff, brush.angle, brush.aspectRatio, shapeInt, falloffInt);
                    } else if (brush.type === 'noise') {
                        engine.applyDimensionalBrush(simX, simY, radius, 2, brush.noiseStrength, currentFalloff, brush.angle, brush.aspectRatio, shapeInt, falloffInt);
                    } else if (brush.type === 'drag') {
                        engine.applyDimensionalBrush(simX, simY, radius, 3, brush.dragStrength, currentFalloff, brush.angle, brush.aspectRatio, shapeInt, falloffInt);
                    }

                    const paintVelocity = (brush.type === 'velocity' || brush.type === 'combined');
                    const paintDensity = (brush.type === 'density' || brush.type === 'combined');
                    const paintTemperature = (brush.type === 'temperature' || brush.type === 'combined');

                    if (paintVelocity || paintDensity || paintTemperature) {
                        let fx = 0, fy = 0, dAmt = 0, tAmt = 0;

                        if (paintVelocity) {
                            if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
                                fx = dx * 0.5 * brush.velocityStrength;
                                fy = dy * 0.5 * brush.velocityStrength;
                            }
                        }
                        
                        if (paintDensity) {
                            dAmt = 0.5 * brush.densityStrength;
                        }

                        if (paintTemperature) {
                            tAmt = 1.0 * brush.temperatureStrength;
                        }

                        if (fx !== 0 || fy !== 0 || dAmt !== 0 || tAmt !== 0) {
                            engine.applyGenericBrush(simX, simY, radius, fx, fy, dAmt, tAmt, currentFalloff, brush.angle, brush.aspectRatio, shapeInt, falloffInt);
                        }
                    }
                }
            }
        }
        
        mouse.lastClientX = clientX;
        mouse.lastClientY = clientY;
    };

    window.addEventListener('resize', () => {
        setTimeout(initSimulation, 100);
    });

    window.addEventListener('keydown', e => {
        switch(e.key.toLowerCase()) {
            case ' ':
                params.simulation.paused = !params.simulation.paused;
                break;
            case 'r':
                params.reset();
                break;
            case 'p':
                params.particles.show = !params.particles.show;
                break;
        }
    });

    canvas.addEventListener('mousedown', e => { 
        mouse.isDragging = true; 
        mouse.lastClientX = e.clientX; 
        mouse.lastClientY = e.clientY; 
        handleInput(e.clientX, e.clientY); 
    });

    window.addEventListener('mouseup', () => mouse.isDragging = false);

    canvas.addEventListener('mousemove', e => { 
        const rect = canvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
        if (mouse.isDragging) handleInput(e.clientX, e.clientY); 
    });

    canvas.addEventListener('mouseenter', () => mouse.isOver = true);
    canvas.addEventListener('mouseleave', () => mouse.isOver = false);
    
    canvas.addEventListener('touchstart', e => { 
        e.preventDefault();
        mouse.isDragging = true; 
        const t = e.touches[0]; 
        mouse.lastClientX = t.clientX; 
        mouse.lastClientY = t.clientY; 
        handleInput(t.clientX, t.clientY);
    }, {passive: false});
    
    canvas.addEventListener('touchmove', e => { 
        e.preventDefault();
        if (mouse.isDragging) {
            const t = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            mouse.x = t.clientX - rect.left;
            mouse.y = t.clientY - rect.top;
            handleInput(t.clientX, t.clientY); 
        }
    }, {passive: false});

    window.addEventListener('touchend', () => mouse.isDragging = false);

    function loop() {
        if(!params.simulation.paused) {
            if (params.simulation.iterations > 0) {
                engine.step(params.simulation.iterations);
            }
        }

        const currentVersion = engine.getDataVersion();
        const views = {};
        const vizMode = params.visualization.mode;
        const particlesOn = params.particles.show;

        const needsUxUy = (vizMode === 0 || vizMode === 1 || vizMode === 4 || particlesOn);
        if (needsUxUy && uploadedVersions.ux !== currentVersion) {
            views.ux = engine.getVelocityXView();
            views.uy = engine.getVelocityYView();
            uploadedVersions.ux = currentVersion;
            uploadedVersions.uy = currentVersion;
        }

        const needsDye = (vizMode === 2);
        if (needsDye && uploadedVersions.dye !== currentVersion) {
            views.dye = engine.getDyeView();
            uploadedVersions.dye = currentVersion;
        }

        const needsTemp = (vizMode === 3);
        if (needsTemp && uploadedVersions.temp !== currentVersion) {
            views.temp = engine.getTemperatureView();
            uploadedVersions.temp = currentVersion;
        }

        const needsDensity = (vizMode === 4);
        if (needsDensity && uploadedVersions.density !== currentVersion) { 
            views.density = engine.getDensityView();
            uploadedVersions.density = currentVersion;
        }
        
        const obsDirty = engine.checkBarrierDirty();
        if (obsDirty) {
            views.obs = engine.getBarrierView();
        }

        const vizParamsWithParticles = { ...params.visualization, particles: params.particles };
        renderer.draw(views, vizParamsWithParticles, params.postProcessing, obsDirty);

        if (!params.simulation.paused && particlesOn) {
            renderer.updateParticles(params.simulation.dt, params.physics);
        }

        if (mouse.isOver && !mouse.isDragging && params.brush.type !== 'none') {
            const brush = params.brush;
            const canvasRadius = (brush.size / simWidth) * canvas.width;
            const color = brush.erase ? [1.0, 0.2, 0.2, 0.7] : [1.0, 1.0, 1.0, 0.7];
            
            let shapeInt = 0;
            if (brush.shape === 'Square') shapeInt = 1;
            if (brush.shape === 'Diamond') shapeInt = 2;

            renderer.drawBrush(mouse.x, mouse.y, canvasRadius, color, brush.angle, brush.aspectRatio, shapeInt);
        }

        const currentTime = performance.now();
        frameCount++;
        if (currentTime > lastTime + 1000) {
            const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
            fpsCounter.textContent = `FPS: ${fps}`;
            lastTime = currentTime;
            frameCount = 0;
        }

        requestId = requestAnimationFrame(loop);
    }

    initSimulation();
});