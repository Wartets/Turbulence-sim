const VS_SOURCE = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FS_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D u_velocity_x;
uniform sampler2D u_velocity_y;
uniform sampler2D u_density;
uniform sampler2D u_obstacles;
uniform sampler2D u_dye;
uniform sampler2D u_temperature;

uniform int u_mode;
uniform float u_contrast;
uniform float u_brightness;
uniform int u_color_scheme;
uniform vec3 u_obstacle_color;
uniform vec3 u_background_color;
uniform bool u_vorticity_bipolar;

in vec2 v_uv;
out vec4 outColor;

vec3 inferno(float t) {
    float r = 0.0002 + 1.2587 * t + 2.7681 * pow(t, 2.0) - 8.3619 * pow(t, 3.0);
    float g = 0.0016 + 0.1477 * t + 3.1206 * pow(t, 2.0) - 2.8093 * pow(t, 3.0);
    float b = 0.0193 + 0.0336 * t - 0.5057 * pow(t, 2.0) + 0.7013 * pow(t, 3.0);
    return clamp(vec3(r, g, b), 0.0, 1.0);
}

vec3 magma(float t) {
    return vec3(
        -0.0021 + 2.4597*t - 3.2384*pow(t,2.0) + 1.6212*pow(t,3.0),
        0.0033 + 0.7716*t + 0.7511*pow(t,2.0) - 0.5594*pow(t,3.0),
        0.0270 + 0.5872*t - 1.2983*pow(t,2.0) + 0.5408*pow(t,3.0)
    );
}

vec3 viridis(float t) {
    return vec3(
        0.2778 + 0.2081*t - 3.5358*pow(t,2.0) + 4.9818*pow(t,3.0),
        0.0055 + 1.5594*t - 0.9022*pow(t,2.0) - 0.2223*pow(t,3.0),
        0.3346 + 0.4705*t + 1.0263*pow(t,2.0) - 1.6318*pow(t,3.0)
    );
}

vec3 plasma(float t) {
    return vec3(
        0.0587 + 2.3734*t - 4.2982*pow(t,2.0) + 2.6565*pow(t,3.0),
        0.0101 + 0.1508*t + 1.5645*pow(t,2.0) - 0.7547*pow(t,3.0),
        0.3387 + 0.0305*t + 1.6601*pow(t,2.0) - 1.0664*pow(t,3.0)
    );
}

vec3 turbo(float t) {
    const vec4 kRedVec4 = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
    const vec4 kGreenVec4 = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
    const vec4 kBlueVec4 = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
    const vec2 kRedVec2 = vec2(-152.94239396, 59.28637943);
    const vec2 kGreenVec2 = vec2(4.27729857, 2.82956604);
    const vec2 kBlueVec2 = vec2(-89.90310912, 27.34824973);
    
    vec4 v4 = vec4(1.0, t, t * t, t * t * t);
    vec2 v2 = v4.zw * v4.z;
    return vec3(
        dot(v4, kRedVec4)   + dot(v2, kRedVec2),
        dot(v4, kGreenVec4) + dot(v2, kGreenVec2),
        dot(v4, kBlueVec4)  + dot(v2, kBlueVec2)
    );
}

vec3 cividis(float t) {
    return vec3(
        0.0033 + 1.2285*t - 6.4719*pow(t,2.0) + 10.3256*pow(t,3.0),
        0.2031 + 2.0830*t - 3.8953*pow(t,2.0) + 2.1295*pow(t,3.0),
        0.0898 - 0.1932*t + 2.2249*pow(t,2.0) - 1.2721*pow(t,3.0)
    );
}

vec3 coolwarm(float t) {
    float r = 0.2298 + 0.1983 * t + 2.0163 * t * t - 1.6364 * t * t * t;
    float g = 0.2969 - 1.5332 * t + 2.1325 * t * t + 0.1531 * t * t * t;
    float b = 0.7441 - 0.9020 * t - 1.8393 * t * t + 2.3353 * t * t * t;
    return vec3(r,g,b);
}

vec3 getPalette(float val, int scheme) {
    val = clamp(val, 0.0, 1.0);
    switch(scheme) {
        case 0: return inferno(val);
        case 1: return magma(val);
        case 2: return plasma(val);
        case 3: return viridis(val);
        case 4: return turbo(val);
        case 5: return vec3(val);
        case 6: return vec3(0.1, 0.3, 0.6) + vec3(0.8, 0.7, 0.4) * val;
        case 7: return cividis(val);
        case 8: return coolwarm(val);
        default: return inferno(val);
    }
}

void main() {
    float is_obstacle = step(0.5, texture(u_obstacles, v_uv).r);
    if (is_obstacle > 0.5) {
        outColor = vec4(u_obstacle_color, 1.0);
        return;
    }

    float ux = texture(u_velocity_x, v_uv).r;
    float uy = texture(u_velocity_y, v_uv).r;
    float rho = texture(u_density, v_uv).r;
    
    vec3 color = vec3(0.0);
    float val = 0.0;

    if (u_mode == 0) { 
        float curl = (dFdx(uy) - dFdy(ux)) * 100.0;
        if (u_vorticity_bipolar) {
            val = curl * 0.5 * u_contrast + 0.5;
            color = getPalette(val, u_color_scheme);
        } else {
            float absCurl = abs(curl * u_contrast);
            color = getPalette(absCurl, u_color_scheme);
        }
    } 
    else if (u_mode == 1) { 
        float speed = sqrt(ux*ux + uy*uy);
        val = speed * 4.0 * u_contrast;
        color = getPalette(val, u_color_scheme);
    } 
    else if (u_mode == 2) { 
        val = texture(u_dye, v_uv).r * u_contrast;
        color = getPalette(val, u_color_scheme);
    }
    else if (u_mode == 3) {
        val = (texture(u_temperature, v_uv).r * 0.1 + 0.5) * u_contrast;
        color = getPalette(val, u_color_scheme);
    }

    vec3 fluid_color = color * u_brightness;
    float intensity = clamp(length(fluid_color) * 5.0, 0.0, 1.0);
    vec3 final_fluid_color = mix(u_background_color, fluid_color, intensity);

    outColor = vec4(final_fluid_color, 1.0);
}
`;

const PARTICLE_VS = `#version 300 es
in vec2 a_position;
uniform vec2 u_resolution;
uniform float u_particle_size;
void main() {
    vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clipSpace * vec2(1, -1), 0.0, 1.0);
    gl_PointSize = u_particle_size;
}`;

const PARTICLE_FS = `#version 300 es
precision mediump float;
uniform vec4 u_particle_color;
out vec4 outColor;
void main() {
    outColor = u_particle_color;
}`;

const BRUSH_VS = `#version 300 es
in vec2 a_position;
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_radius;

void main() {
    vec2 pos = u_center + a_position * u_radius;
    vec2 clipSpace = (pos / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
}`;

const BRUSH_FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 outColor;
void main() {
    outColor = u_color;
}`;