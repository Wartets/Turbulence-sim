#include "engine.h"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <cstdlib>

using namespace emscripten;

const int slip_h[9] = {0, 1, 4, 3, 2, 8, 7, 6, 5};
const int slip_v[9] = {0, 3, 2, 1, 4, 6, 5, 8, 7};
const int cx[9] = {0, 1, 0, -1, 0, 1, -1, -1, 1};
const int cy[9] = {0, 0, 1, 0, -1, 1, 1, -1, -1};
const int opp[9] = {0, 3, 4, 1, 2, 7, 8, 5, 6};
const float weights[9] = {4.0f/9.0f, 1.0f/9.0f, 1.0f/9.0f, 1.0f/9.0f, 1.0f/9.0f, 1.0f/36.0f, 1.0f/36.0f, 1.0f/36.0f, 1.0f/36.0f};

FluidEngine::FluidEngine(int width, int height) : w(width), h(height), omega(1.85f), decay(0.0f), velocityDissipation(0.0f), dt(1.0f), boundaryType(0), gravityX(0.0f), gravityY(0.0f), buoyancy(0.0f), thermalDiffusivity(0.0f), vorticityConfinement(0.0f), maxVelocity(0.57f), threadCount(1) {
    std::cout << "DEBUG: FluidEngine Created (w=" << width << ", h=" << height << "). Threading support initialized." << std::endl;
    int size = w * h;
    f.resize(size * 9);
    f_new.resize(size * 9);
    rho.resize(size, 1.0f);
    ux.resize(size, 0.0f);
    uy.resize(size, 0.0f);
    barriers.resize(size, 0);
    dye.resize(size, 0.0f);
    dye_new.resize(size, 0.0f);
    temperature.resize(size, 0.0f);
    temperature_new.resize(size, 0.0f);

    for (int i = 0; i < size; ++i) {
        float feq[9];
        equilibrium(1.0f, 0.0f, 0.0f, feq);
        for (int k = 0; k < 9; ++k) {
            f[i * 9 + k] = feq[k];
        }
    }
}

void FluidEngine::setThreadCount(int count) {
    std::cout << "DEBUG: setThreadCount called with " << count << std::endl;
    threadCount = std::max(1, count);
}

void FluidEngine::parallel_for(int start, int end, std::function<void(int, int)> func) {
    if (threadCount <= 1) {
        func(start, end);
    } else {
        #ifdef __EMSCRIPTEN_PTHREADS__
            std::vector<std::thread> threads;
            int total = end - start;
            int chunk = total / threadCount;
            for (int i = 0; i < threadCount; ++i) {
                int range_start = start + i * chunk;
                int range_end = (i == threadCount - 1) ? end : range_start + chunk;
                threads.emplace_back(func, range_start, range_end);
            }
            for (auto& t : threads) {
                t.join();
            }
        #else
            func(start, end);
        #endif
    }
}

void FluidEngine::equilibrium(float r, float u, float v, float* feq) {
    float u2 = u * u + v * v;
    for (int k = 0; k < 9; ++k) {
        float eu = cx[k] * u + cy[k] * v;
        feq[k] = weights[k] * r * (1.0f + 3.0f * eu + 4.5f * eu * eu - 1.5f * u2);
    }
}

void FluidEngine::setViscosity(float viscosity) {
    omega = 1.0f / (3.0f * viscosity + 0.5f);
}

void FluidEngine::setDecay(float newDecay) {
    decay = newDecay;
}

void FluidEngine::setBoundaryType(int type) {
    boundaryType = type;
}

void FluidEngine::setDt(float newDt) {
    dt = newDt;
}

void FluidEngine::setGravity(float gx, float gy) {
    gravityX = gx;
    gravityY = gy;
}

void FluidEngine::setBuoyancy(float b) {
    buoyancy = b;
}

void FluidEngine::setThermalDiffusivity(float td) {
    thermalDiffusivity = td;
}

void FluidEngine::setVorticityConfinement(float vc) {
    vorticityConfinement = vc;
}

void FluidEngine::setVelocityDissipation(float dissipation) {
    velocityDissipation = dissipation;
}

void FluidEngine::applyDimensionalBrush(int x, int y, int radius, int mode, float strength, float falloffParam) {
    int r2 = radius * radius;
    for (int dy = -radius; dy <= radius; ++dy) {
        for (int dx = -radius; dx <= radius; ++dx) {
            int d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;

            int nx = x + dx;
            int ny = y + dy;

            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

            int idx = ny * w + nx;
            if (barriers[idx]) continue;

            float dist = std::sqrt((float)d2);
            float normDist = (radius > 0) ? dist / (float)radius : 0.0f;
            float t = 1.0f - normDist;
            if (t < 0.0f) t = 0.0f;
            float smoothT = t * t * (3.0f - 2.0f * t);
            float weight = (1.0f - falloffParam) + falloffParam * smoothT;

            if (mode == 0) { // Vortex
                float fx = -dy * strength * weight;
                float fy = dx * strength * weight;
                ux[idx] += fx * dt;
                uy[idx] += fy * dt;
            } else if (mode == 1) { // Divergence (Expansion/Contraction)
                float fx = dx * strength * weight;
                float fy = dy * strength * weight;
                ux[idx] += fx * dt;
                uy[idx] += fy * dt;
            } else if (mode == 2) { // Noise
                float randX = ((float)rand() / (float)RAND_MAX - 0.5f) * 2.0f;
                float randY = ((float)rand() / (float)RAND_MAX - 0.5f) * 2.0f;
                ux[idx] += randX * strength * weight * dt;
                uy[idx] += randY * strength * weight * dt;
            } else if (mode == 3) { // Drag (Dampen)
                float dampen = 1.0f - (strength * weight * dt);
                if (dampen < 0.0f) dampen = 0.0f;
                ux[idx] *= dampen;
                uy[idx] *= dampen;
            }

            limitVelocity(ux[idx], uy[idx]);
            
            float feq[9];
            equilibrium(rho[idx], ux[idx], uy[idx], feq);
            for(int k=0; k<9; k++) f[idx*9 + k] = feq[k];
        }
    }
}

void FluidEngine::addTemperature(int x, int y, float amount) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    int idx = y * w + x;
    
    if (barriers[idx]) return;

    temperature[idx] += amount;
}

void FluidEngine::limitVelocity(float &u, float &v) {
    float speed = std::sqrt(u*u + v*v);
    if (speed > maxVelocity) {
        float ratio = maxVelocity / speed;
        u *= ratio;
        v *= ratio;
    }
}

void FluidEngine::setMaxVelocity(float mv) {
    maxVelocity = mv;
}

void FluidEngine::addForce(int x, int y, float fx, float fy) {
    if (x < 1 || x >= w - 1 || y < 1 || y >= h - 1) return;
    int idx = y * w + x;
    
    if (barriers[idx]) return;

    ux[idx] += fx * dt;
    uy[idx] += fy * dt;
    
    limitVelocity(ux[idx], uy[idx]);

    float feq[9];
    equilibrium(rho[idx], ux[idx], uy[idx], feq);
    for(int k=0; k<9; k++) f[idx*9 + k] = feq[k];
}

void FluidEngine::addDensity(int x, int y, float amount) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    int idx = y * w + x;
    
    if (barriers[idx]) return;

    dye[idx] += amount;
}

void FluidEngine::addObstacle(int x, int y, int radius, bool remove) {
    for (int dy = -radius; dy <= radius; ++dy) {
        for (int dx = -radius; dx <= radius; ++dx) {
            if (dx * dx + dy * dy <= radius * radius) {
                int nx = x + dx;
                int ny = y + dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    int idx = ny * w + nx;
                    barriers[idx] = remove ? 0 : 255;
                    
                    if (!remove) {
                        ux[idx] = 0.0f;
                        uy[idx] = 0.0f;
                        rho[idx] = 1.0f;
                        dye[idx] = 0.0f;
                        temperature[idx] = 0.0f;
                        float feq[9];
                        equilibrium(1.0f, 0.0f, 0.0f, feq);
                        for(int k=0; k<9; ++k) f[idx * 9 + k] = feq[k];
                    }
                }
            }
        }
    }
}

void FluidEngine::reset() {
    int size = w * h;
    std::fill(rho.begin(), rho.end(), 1.0f);
    std::fill(ux.begin(), ux.end(), 0.0f);
    std::fill(uy.begin(), uy.end(), 0.0f);
    std::fill(barriers.begin(), barriers.end(), 0);
    std::fill(dye.begin(), dye.end(), 0.0f);
    std::fill(temperature.begin(), temperature.end(), 0.0f);

    float feq[9];
    equilibrium(1.0f, 0.0f, 0.0f, feq);

    for (int i = 0; i < size; ++i) {
        for (int k = 0; k < 9; ++k) {
            f[i * 9 + k] = feq[k];
        }
    }
}

void FluidEngine::clearRegion(int x, int y, int radius) {
    for (int dy = -radius; dy <= radius; ++dy) {
        for (int dx = -radius; dx <= radius; ++dx) {
            if (dx * dx + dy * dy <= radius * radius) {
                int nx = x + dx;
                int ny = y + dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    int idx = ny * w + nx;
                    barriers[idx] = 0; 
                    rho[idx] = 1.0f;
                    ux[idx] = 0.0f;
                    uy[idx] = 0.0f;
                    dye[idx] = 0.0f;
                    temperature[idx] = 0.0f;

                    float feq[9];
                    equilibrium(1.0f, 0.0f, 0.0f, feq);
                    for (int k = 0; k < 9; ++k) f[idx * 9 + k] = feq[k];
                }
            }
        }
    }
}

void FluidEngine::step(int iterations) {
    for(int i=0; i<iterations; ++i) {
        collideAndStream();
        advectDye();
        advectTemperature();
    }
}

void FluidEngine::collideAndStream() {
    int size = w * h;

    std::vector<float> forceX(size, 0.0f);
    std::vector<float> forceY(size, 0.0f);

    for (int i = 0; i < size; ++i) {
        if (barriers[i]) continue;
        
        float r = 0.0f;
        float u_val = 0.0f;
        float v_val = 0.0f;
        
        for (int k = 0; k < 9; ++k) {
            r += f[i * 9 + k];
        }
        
        if (r > 0) {
            for (int k = 0; k < 9; ++k) {
                u_val += f[i * 9 + k] * cx[k];
                v_val += f[i * 9 + k] * cy[k];
            }
            u_val /= r;
            v_val /= r;
        }
        
        rho[i] = r;
        ux[i] = u_val;
        uy[i] = v_val;
    }

    if (vorticityConfinement > 0.0f) {
        std::vector<float> curl(size, 0.0f);
        for (int y = 1; y < h - 1; ++y) {
            for (int x = 1; x < w - 1; ++x) {
                int idx = y * w + x;
                if (barriers[idx] || barriers[idx+1] || barriers[idx-1] || barriers[idx+w] || barriers[idx-w]) continue;
                curl[idx] = uy[idx + 1] - uy[idx - 1] - (ux[idx + w] - ux[idx - w]);
            }
        }
        
        for (int y = 1; y < h - 1; ++y) {
            for (int x = 1; x < w - 1; ++x) {
                int idx = y * w + x;
                if (barriers[idx]) continue;
                
                float dc_dx = (std::abs(curl[idx + 1]) - std::abs(curl[idx - 1])) * 0.5f;
                float dc_dy = (std::abs(curl[idx + w]) - std::abs(curl[idx - w])) * 0.5f;
                float mag_grad = std::sqrt(dc_dx * dc_dx + dc_dy * dc_dy);
                
                if (mag_grad > 1e-6f) {
                    forceX[idx] = vorticityConfinement * (dc_dy / mag_grad) * curl[idx];
                    forceY[idx] = vorticityConfinement * (-dc_dx / mag_grad) * curl[idx];
                }
            }
        }
    }
    
    for (int i = 0; i < size; ++i) {
        if (barriers[i]) {
            rho[i] = 1.0f;
            ux[i] = 0.0f;
            uy[i] = 0.0f;
            float feq[9];
            equilibrium(1.0f, 0.0f, 0.0f, feq);
            for(int k=0; k<9; ++k) {
                f_new[i*9 + k] = feq[k];
            }
            continue;
        }

        float u_final = ux[i] + (gravityX + forceX[i]) * dt;
        float v_final = uy[i] + (gravityY + buoyancy * temperature[i] + forceY[i]) * dt;
        
        if (velocityDissipation > 0.0f) {
            float damp = 1.0f - velocityDissipation;
            if (damp < 0.0f) damp = 0.0f;
            u_final *= damp;
            v_final *= damp;
        }

        limitVelocity(u_final, v_final);
        ux[i] = u_final;
        uy[i] = v_final;

        float feq[9];
        equilibrium(rho[i], u_final, v_final, feq);

        for (int k = 0; k < 9; ++k) {
            f_new[i*9 + k] = f[i*9 + k] * (1.0f - omega) + feq[k] * omega;
        }
    }

    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            int currentIdx = y * w + x;
            
            for (int k = 0; k < 9; ++k) {
                int sx = x - cx[k];
                int sy = y - cy[k];
                int sourceIdx = -1;
                int reflect_k = -1;

                switch(boundaryType) {
                    case 0: // Periodic
                        sx = (sx + w) % w;
                        sy = (sy + h) % h;
                        sourceIdx = sy * w + sx;
                        break;
                    case 1: // Box (no-slip)
                        if (sx < 0 || sx >= w || sy < 0 || sy >= h) {
                            reflect_k = opp[k];
                        } else {
                            sourceIdx = sy * w + sx;
                        }
                        break;
                    case 2: // Channel X (periodic x, no-slip y)
                        sx = (sx + w) % w;
                        if (sy < 0 || sy >= h) {
                            reflect_k = opp[k];
                        } else {
                            sourceIdx = sy * w + sx;
                        }
                        break;
                    case 3: // Channel Y (no-slip x, periodic y)
                        sy = (sy + h) % h;
                        if (sx < 0 || sx >= w) {
                            reflect_k = opp[k];
                        } else {
                            sourceIdx = sy * w + sx;
                        }
                        break;
                    case 4: // Slip Box
                        if (sx < 0 || sx >= w) {
                            reflect_k = slip_v[k];
                        } else if (sy < 0 || sy >= h) {
                            reflect_k = slip_h[k];
                        } else {
                            sourceIdx = sy * w + sx;
                        }
                        break;
                    case 5: // Slip Channel X (periodic x, slip y)
                        sx = (sx + w) % w;
                         if (sy < 0 || sy >= h) {
                            reflect_k = slip_h[k];
                        } else {
                            sourceIdx = sy * w + sx;
                        }
                        break;
                }

                if (reflect_k != -1) {
                    f[currentIdx * 9 + k] = f_new[currentIdx * 9 + reflect_k];
                } else {
                    if (barriers[sourceIdx]) {
                        f[currentIdx * 9 + k] = f_new[currentIdx * 9 + opp[k]];
                    } else {
                        f[currentIdx * 9 + k] = f_new[sourceIdx * 9 + k];
                    }
                }
            }
        }
    }
}

void FluidEngine::advectDye() {
    parallel_for(0, h, [&](int startY, int endY) {
        for (int y = startY; y < endY; ++y) {
            for (int x = 0; x < w; ++x) {
                int idx = y * w + x;
                if (barriers[idx]) {
                    dye_new[idx] = 0.0f;
                    continue;
                }

                float x_prev = (float)x - ux[idx] * dt;
                float y_prev = (float)y - uy[idx] * dt;

                if (x_prev < 0.5f) x_prev = 0.5f;
                if (x_prev > w - 1.5f) x_prev = w - 1.5f;
                if (y_prev < 0.5f) y_prev = 0.5f;
                if (y_prev > h - 1.5f) y_prev = h - 1.5f;

                int ix = static_cast<int>(x_prev);
                int iy = static_cast<int>(y_prev);
                float fx = x_prev - ix;
                float fy = y_prev - iy;

                int idx_tl = iy * w + ix;
                int idx_tr = idx_tl + 1;
                int idx_bl = (iy + 1) * w + ix;
                int idx_br = idx_bl + 1;

                float d_tl = barriers[idx_tl] ? 0.0f : dye[idx_tl];
                float d_tr = barriers[idx_tr] ? 0.0f : dye[idx_tr];
                float d_bl = barriers[idx_bl] ? 0.0f : dye[idx_bl];
                float d_br = barriers[idx_br] ? 0.0f : dye[idx_br];
                
                float interpolated_dye = (1.0f - fx) * (1.0f - fy) * d_tl +
                                         fx * (1.0f - fy) * d_tr +
                                         (1.0f - fx) * fy * d_bl +
                                         fx * fy * d_br;
                
                dye_new[idx] = interpolated_dye * (1.0f - decay);
            }
        }
    });
    dye.swap(dye_new);
}

val FluidEngine::getDyeView() {
    return val(typed_memory_view(w * h, dye.data()));
}

void FluidEngine::advectTemperature() {
    parallel_for(0, h, [&](int startY, int endY) {
        for (int y = startY; y < endY; ++y) {
            for (int x = 0; x < w; ++x) {
                int idx = y * w + x;
                if (barriers[idx]) {
                    temperature_new[idx] = 0.0f;
                    continue;
                }

                float x_prev = (float)x - ux[idx] * dt;
                float y_prev = (float)y - uy[idx] * dt;

                if (x_prev < 0.5f) x_prev = 0.5f;
                if (x_prev > w - 1.5f) x_prev = w - 1.5f;
                if (y_prev < 0.5f) y_prev = 0.5f;
                if (y_prev > h - 1.5f) y_prev = h - 1.5f;

                int ix = static_cast<int>(x_prev);
                int iy = static_cast<int>(y_prev);
                float fx = x_prev - ix;
                float fy = y_prev - iy;

                int idx_tl = iy * w + ix;
                int idx_tr = idx_tl + 1;
                int idx_bl = (iy + 1) * w + ix;
                int idx_br = idx_bl + 1;

                float t_tl = barriers[idx_tl] ? 0.0f : temperature[idx_tl];
                float t_tr = barriers[idx_tr] ? 0.0f : temperature[idx_tr];
                float t_bl = barriers[idx_bl] ? 0.0f : temperature[idx_bl];
                float t_br = barriers[idx_br] ? 0.0f : temperature[idx_br];
                
                float interpolated_temp = (1.0f - fx) * (1.0f - fy) * t_tl +
                                         fx * (1.0f - fy) * t_tr +
                                         (1.0f - fx) * fy * t_bl +
                                         fx * fy * t_br;
                
                temperature_new[idx] = interpolated_temp * (1.0f - thermalDiffusivity);
            }
        }
    });
    temperature.swap(temperature_new);
}

val FluidEngine::getTemperatureView() {
    return val(typed_memory_view(w * h, temperature.data()));
}

val FluidEngine::getDensityView() {
    return val(typed_memory_view(w * h, rho.data()));
}

val FluidEngine::getVelocityXView() {
    return val(typed_memory_view(w * h, ux.data()));
}

val FluidEngine::getVelocityYView() {
    return val(typed_memory_view(w * h, uy.data()));
}

val FluidEngine::getBarrierView() {
    return val(typed_memory_view(w * h, barriers.data()));
}

EMSCRIPTEN_BINDINGS(fluid_module) {
    class_<FluidEngine>("FluidEngine")
        .constructor<int, int>()
        .function("setThreadCount", &FluidEngine::setThreadCount)
        .function("step", &FluidEngine::step)
        .function("addForce", &FluidEngine::addForce)
        .function("addDensity", &FluidEngine::addDensity)
        .function("addTemperature", &FluidEngine::addTemperature)
        .function("setViscosity", &FluidEngine::setViscosity)
        .function("setDecay", &FluidEngine::setDecay)
        .function("setVelocityDissipation", &FluidEngine::setVelocityDissipation)
        .function("setDt", &FluidEngine::setDt)
        .function("setGravity", &FluidEngine::setGravity)
        .function("setBoundaryType", &FluidEngine::setBoundaryType)
        .function("setBuoyancy", &FluidEngine::setBuoyancy)
        .function("setThermalDiffusivity", &FluidEngine::setThermalDiffusivity)
        .function("setVorticityConfinement", &FluidEngine::setVorticityConfinement)
        .function("setMaxVelocity", &FluidEngine::setMaxVelocity)
        .function("reset", &FluidEngine::reset)
        .function("clearRegion", &FluidEngine::clearRegion)
        .function("addObstacle", &FluidEngine::addObstacle)
        .function("applyDimensionalBrush", &FluidEngine::applyDimensionalBrush)
        .function("getDensityView", &FluidEngine::getDensityView)
        .function("getVelocityXView", &FluidEngine::getVelocityXView)
        .function("getVelocityYView", &FluidEngine::getVelocityYView)
        .function("getBarrierView", &FluidEngine::getBarrierView)
        .function("getDyeView", &FluidEngine::getDyeView)
        .function("getTemperatureView", &FluidEngine::getTemperatureView);
}