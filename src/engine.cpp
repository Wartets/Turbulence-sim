#include "engine.h"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <cstdlib>
#include <future>
#include <memory>
#include <wasm_simd128.h>

using namespace emscripten;

const int slip_h[9] = {0, 1, 4, 3, 2, 8, 7, 6, 5};
const int slip_v[9] = {0, 3, 2, 1, 4, 6, 5, 8, 7};
const int cx[9] = {0, 1, 0, -1, 0, 1, -1, -1, 1};
const int cy[9] = {0, 0, 1, 0, -1, 1, 1, -1, -1};
const int opp[9] = {0, 3, 4, 1, 2, 7, 8, 5, 6};
const float weights[9] = {4.0f/9.0f, 1.0f/9.0f, 1.0f/9.0f, 1.0f/9.0f, 1.0f/9.0f, 1.0f/36.0f, 1.0f/36.0f, 1.0f/36.0f, 1.0f/36.0f};

FluidEngine::FluidEngine(int width, int height) : w(width), h(height), omega(1.85f), decay(0.0f), velocityDissipation(0.0f), dt(1.0f), boundaryType(0), gravityX(0.0f), gravityY(0.0f), buoyancy(0.0f), thermalDiffusivity(0.0f), vorticityConfinement(0.0f), maxVelocity(0.57f), threadCount(1), stop(false) {
    std::cout << "DEBUG: FluidEngine Created (w=" << width << ", h=" << height << "). Threading support initialized." << std::endl;
    int size = w * h;
    for(int k = 0; k < 9; ++k) {
        f[k].resize(size);
        f_new[k].resize(size);
    }
    rho.resize(size, 1.0f);
    ux.resize(size, 0.0f);
    uy.resize(size, 0.0f);
    barriers.resize(size, 0);
    dye.resize(size, 0.0f);
    dye_new.resize(size, 0.0f);
    temperature.resize(size, 0.0f);
    temperature_new.resize(size, 0.0f);
    
    forceX.resize(size, 0.0f);
    forceY.resize(size, 0.0f);
    curl.resize(size, 0.0f);

    float feq[9];
    equilibrium(1.0f, 0.0f, 0.0f, feq);
    for (int k = 0; k < 9; ++k) {
        std::fill(f[k].begin(), f[k].end(), feq[k]);
    }
}

FluidEngine::~FluidEngine() {
    {
        std::unique_lock<std::mutex> lock(queue_mutex);
        stop = true;
    }
    condition.notify_all();
    for (std::thread &worker : workers) {
        if (worker.joinable()) {
            worker.join();
        }
    }
}

void FluidEngine::initThreadPool(int count) {
    #ifdef __EMSCRIPTEN_PTHREADS__
        for(int i = 0; i < count; ++i) {
            workers.emplace_back([this] {
                while(true) {
                    std::function<void()> task;
                    {
                        std::unique_lock<std::mutex> lock(queue_mutex);
                        condition.wait(lock, [this]{ return stop || !tasks.empty(); });
                        if(stop && tasks.empty()) return;
                        task = std::move(tasks.front());
                        tasks.pop();
                    }
                    task();
                }
            });
        }
    #endif
}

void FluidEngine::setThreadCount(int count) {
    std::cout << "DEBUG: setThreadCount called with " << count << std::endl;
    int newCount = std::max(1, count);
    
    if (newCount == threadCount && !workers.empty()) return;

    {
        std::unique_lock<std::mutex> lock(queue_mutex);
        stop = true;
    }
    condition.notify_all();
    for(std::thread &worker : workers) {
        if(worker.joinable()) worker.join();
    }
    workers.clear();

    threadCount = newCount;
    stop = false;
    
    if (threadCount > 1) {
        initThreadPool(threadCount);
    }
}

void FluidEngine::parallel_for(int start, int end, std::function<void(int, int)> func) {
    if (threadCount <= 1) {
        func(start, end);
    } else {
        #ifdef __EMSCRIPTEN_PTHREADS__
            std::vector<std::future<void>> futures;
            int total = end - start;
            int chunk = total / threadCount;
            
            for (int i = 0; i < threadCount; ++i) {
                int range_start = start + i * chunk;
                int range_end = (i == threadCount - 1) ? end : range_start + chunk;
                
                auto task = std::make_shared<std::packaged_task<void()>>(
                    [func, range_start, range_end](){
                        func(range_start, range_end);
                    }
                );
                
                futures.emplace_back(task->get_future());
                
                {
                    std::unique_lock<std::mutex> lock(queue_mutex);
                    tasks.emplace([task](){ (*task)(); });
                }
            }
            condition.notify_all();
            
            for(auto &f : futures) {
                f.wait();
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

void FluidEngine::applyDimensionalBrush(int x, int y, int radius, int mode, float strength, float falloffParam, float angle, float aspectRatio, int shape, int falloffMode) {
    float rad = (float)radius;
    float angRad = angle * 3.14159265f / 180.0f;
    float cosA = std::cos(angRad);
    float sinA = std::sin(angRad);
    float aspect = std::max(0.01f, aspectRatio);

    for (int dy = -radius; dy <= radius; ++dy) {
        for (int dx = -radius; dx <= radius; ++dx) {
            
            float px = (float)dx;
            float py = (float)dy;

            float rx = px * cosA - py * sinA;
            float ry = px * sinA + py * cosA;

            ry /= aspect;

            float dist = 0.0f;
            if (shape == 0) { 
                dist = std::sqrt(rx * rx + ry * ry);
            } else if (shape == 1) { 
                dist = std::max(std::abs(rx), std::abs(ry));
            } else if (shape == 2) { 
                dist = (std::abs(rx) + std::abs(ry)); 
                if (shape == 2) dist *= 0.7071f; 
            }

            if (dist > rad) continue;

            int nx = x + dx;
            int ny = y + dy;

            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

            int idx = ny * w + nx;
            if (barriers[idx]) continue;

            float weight = 0.0f;
            float normDist = dist / rad;
            
            if (falloffMode == 1) { 
                weight = std::exp(-normDist * normDist * falloffParam);
            } else { 
                float t = 1.0f - normDist;
                if (t < 0.0f) t = 0.0f;
                float smoothT = t * t * (3.0f - 2.0f * t);
                weight = (1.0f - falloffParam) + falloffParam * smoothT;
            }

            if (mode == 0) { 
                float fx = -dy * strength * weight;
                float fy = dx * strength * weight;
                ux[idx] += fx * dt;
                uy[idx] += fy * dt;
            } else if (mode == 1) { 
                float fx = dx * strength * weight;
                float fy = dy * strength * weight;
                ux[idx] += fx * dt;
                uy[idx] += fy * dt;
            } else if (mode == 2) { 
                float randX = ((float)rand() / (float)RAND_MAX - 0.5f) * 2.0f;
                float randY = ((float)rand() / (float)RAND_MAX - 0.5f) * 2.0f;
                ux[idx] += randX * strength * weight * dt;
                uy[idx] += randY * strength * weight * dt;
            } else if (mode == 3) { 
                float dampen = 1.0f - (strength * weight * dt);
                if (dampen < 0.0f) dampen = 0.0f;
                ux[idx] *= dampen;
                uy[idx] *= dampen;
            }

            limitVelocity(ux[idx], uy[idx]);
            
            float feq[9];
            equilibrium(rho[idx], ux[idx], uy[idx], feq);
            for(int k=0; k<9; k++) f[k][idx] = feq[k];
        }
    }
}

void FluidEngine::applyGenericBrush(int x, int y, int radius, float fx, float fy, float densityAmt, float tempAmt, float falloffParam, float angle, float aspectRatio, int shape, int falloffMode) {
    float rad = (float)radius;
    bool applyForce = (std::abs(fx) > 1e-5f || std::abs(fy) > 1e-5f);
    
    float angRad = angle * 3.14159265f / 180.0f;
    float cosA = std::cos(angRad);
    float sinA = std::sin(angRad);
    float aspect = std::max(0.01f, aspectRatio);

    for (int dy = -radius; dy <= radius; ++dy) {
        for (int dx = -radius; dx <= radius; ++dx) {
            
            float px = (float)dx;
            float py = (float)dy;

            float rx = px * cosA - py * sinA;
            float ry = px * sinA + py * cosA;

            ry /= aspect;

            float dist = 0.0f;
            if (shape == 0) { 
                dist = std::sqrt(rx * rx + ry * ry);
            } else if (shape == 1) { 
                dist = std::max(std::abs(rx), std::abs(ry));
            } else if (shape == 2) { 
                dist = (std::abs(rx) + std::abs(ry)); 
                if (shape == 2) dist *= 0.7071f;
            }

            if (dist > rad) continue;

            int nx = x + dx;
            int ny = y + dy;

            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

            int idx = ny * w + nx;
            if (barriers[idx]) continue;

            float weight = 0.0f;
            float normDist = dist / rad;

            if (falloffMode == 1) {
                weight = std::exp(-normDist * normDist * falloffParam);
            } else {
                float t = 1.0f - normDist;
                if (t < 0.0f) t = 0.0f;
                float smoothT = t * t * (3.0f - 2.0f * t);
                weight = (1.0f - falloffParam) + falloffParam * smoothT;
            }

            if (applyForce) {
                ux[idx] += fx * weight * dt;
                uy[idx] += fy * weight * dt;
                limitVelocity(ux[idx], uy[idx]);
            }

            if (densityAmt != 0.0f) {
                dye[idx] += densityAmt * weight;
            }
            
            if (tempAmt != 0.0f) {
                temperature[idx] += tempAmt * weight;
            }
            
            if (applyForce) {
                 float feq[9];
                 equilibrium(rho[idx], ux[idx], uy[idx], feq);
                 for(int k=0; k<9; k++) f[k][idx] = feq[k];
            }
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
    for(int k=0; k<9; k++) f[k][idx] = feq[k];
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
                        for(int k=0; k<9; ++k) f[k][idx] = feq[k];
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

    for (int k = 0; k < 9; ++k) {
        std::fill(f[k].begin(), f[k].end(), feq[k]);
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
                    for (int k = 0; k < 9; ++k) f[k][idx] = feq[k];
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
    parallel_for(0, h, [&](int startY, int endY) {
        v128_t v_weights[9];
        v128_t v_cx[9];
        v128_t v_cy[9];
        for(int k=0; k<9; ++k) {
            v_weights[k] = wasm_f32x4_splat(weights[k]);
            v_cx[k] = wasm_f32x4_splat((float)cx[k]);
            v_cy[k] = wasm_f32x4_splat((float)cy[k]);
        }
        
        v128_t v_omega = wasm_f32x4_splat(omega);
        v128_t v_one_minus_omega = wasm_f32x4_splat(1.0f - omega);
        v128_t v_dt = wasm_f32x4_splat(dt);
        v128_t v_one = wasm_f32x4_splat(1.0f);
        v128_t v_three = wasm_f32x4_splat(3.0f);
        v128_t v_four_point_five = wasm_f32x4_splat(4.5f);
        v128_t v_one_point_five = wasm_f32x4_splat(1.5f);
        v128_t v_gravityX = wasm_f32x4_splat(gravityX);
        v128_t v_gravityY = wasm_f32x4_splat(gravityY);
        v128_t v_buoyancy = wasm_f32x4_splat(buoyancy);
        v128_t v_dissipation = wasm_f32x4_splat(1.0f - velocityDissipation);
        v128_t v_maxVel = wasm_f32x4_splat(maxVelocity);

        float feq_rest[9];
        equilibrium(1.0f, 0.0f, 0.0f, feq_rest);

        for (int y = startY; y < endY; ++y) {
            int x = 0;
            int simd_width = w - (w % 4);

            for (; x < simd_width; x += 4) {
                int idx = y * w + x;

                v128_t v_f[9];
                for(int k=0; k<9; ++k) {
                    v_f[k] = wasm_v128_load(&f[k][idx]);
                }

                v128_t v_rho = v_f[0];
                for(int k=1; k<9; ++k) {
                    v_rho = wasm_f32x4_add(v_rho, v_f[k]);
                }

                v128_t v_ux = wasm_f32x4_mul(v_f[1], v_cx[1]);
                v128_t v_uy = wasm_f32x4_mul(v_f[1], v_cy[1]);
                
                v_ux = wasm_f32x4_add(v_ux, wasm_f32x4_mul(v_f[3], v_cx[3]));
                v_ux = wasm_f32x4_add(v_ux, wasm_f32x4_mul(v_f[5], v_cx[5]));
                v_ux = wasm_f32x4_add(v_ux, wasm_f32x4_mul(v_f[6], v_cx[6]));
                v_ux = wasm_f32x4_add(v_ux, wasm_f32x4_mul(v_f[7], v_cx[7]));
                v_ux = wasm_f32x4_add(v_ux, wasm_f32x4_mul(v_f[8], v_cx[8]));

                v_uy = wasm_f32x4_add(v_uy, wasm_f32x4_mul(v_f[2], v_cy[2]));
                v_uy = wasm_f32x4_add(v_uy, wasm_f32x4_mul(v_f[4], v_cy[4]));
                v_uy = wasm_f32x4_add(v_uy, wasm_f32x4_mul(v_f[5], v_cy[5]));
                v_uy = wasm_f32x4_add(v_uy, wasm_f32x4_mul(v_f[6], v_cy[6]));
                v_uy = wasm_f32x4_add(v_uy, wasm_f32x4_mul(v_f[7], v_cy[7]));
                v_uy = wasm_f32x4_add(v_uy, wasm_f32x4_mul(v_f[8], v_cy[8]));

                v128_t v_rho_inv = wasm_f32x4_div(v_one, wasm_f32x4_max(v_rho, wasm_f32x4_splat(1e-6f)));
                v_ux = wasm_f32x4_mul(v_ux, v_rho_inv);
                v_uy = wasm_f32x4_mul(v_uy, v_rho_inv);

                v128_t v_forceX = wasm_v128_load(&forceX[idx]);
                v128_t v_forceY = wasm_v128_load(&forceY[idx]);
                v128_t v_temp = wasm_v128_load(&temperature[idx]);

                v128_t v_fx = wasm_f32x4_add(v_gravityX, v_forceX);
                v128_t v_fy = wasm_f32x4_add(v_gravityY, wasm_f32x4_add(wasm_f32x4_mul(v_buoyancy, v_temp), v_forceY));

                v_ux = wasm_f32x4_add(v_ux, wasm_f32x4_mul(v_fx, v_dt));
                v_uy = wasm_f32x4_add(v_uy, wasm_f32x4_mul(v_fy, v_dt));

                if (velocityDissipation > 0.0f) {
                    v_ux = wasm_f32x4_mul(v_ux, v_dissipation);
                    v_uy = wasm_f32x4_mul(v_uy, v_dissipation);
                }

                v128_t v_speed = wasm_f32x4_sqrt(wasm_f32x4_add(wasm_f32x4_mul(v_ux, v_ux), wasm_f32x4_mul(v_uy, v_uy)));
                v128_t v_mask = wasm_f32x4_gt(v_speed, v_maxVel);
                if (wasm_v128_any_true(v_mask)) {
                   v128_t v_ratio = wasm_f32x4_div(v_maxVel, v_speed);
                   v_ux = wasm_v128_bitselect(wasm_f32x4_mul(v_ux, v_ratio), v_ux, v_mask);
                   v_uy = wasm_v128_bitselect(wasm_f32x4_mul(v_uy, v_ratio), v_uy, v_mask);
                }

                wasm_v128_store(&rho[idx], v_rho);
                wasm_v128_store(&ux[idx], v_ux);
                wasm_v128_store(&uy[idx], v_uy);

                v128_t v_u2 = wasm_f32x4_add(wasm_f32x4_mul(v_ux, v_ux), wasm_f32x4_mul(v_uy, v_uy));
                v128_t v_usq_term = wasm_f32x4_mul(v_u2, v_one_point_five);

                v128_t v_f_out[9];

                for (int k = 0; k < 9; ++k) {
                    v128_t v_eu = wasm_f32x4_add(wasm_f32x4_mul(v_cx[k], v_ux), wasm_f32x4_mul(v_cy[k], v_uy));
                    v128_t v_feq = wasm_f32x4_mul(v_weights[k], v_rho);
                    
                    v128_t v_term = wasm_f32x4_add(v_one, wasm_f32x4_mul(v_eu, v_three));
                    v_term = wasm_f32x4_add(v_term, wasm_f32x4_sub(wasm_f32x4_mul(wasm_f32x4_mul(v_eu, v_eu), v_four_point_five), v_usq_term));
                    v_feq = wasm_f32x4_mul(v_feq, v_term);
                    
                    v_f_out[k] = wasm_f32x4_add(wasm_f32x4_mul(v_f[k], v_one_minus_omega), wasm_f32x4_mul(v_feq, v_omega));
                }

                float f_out_batch[9][4];
                for(int k=0; k<9; ++k) {
                    wasm_v128_store((v128_t*)f_out_batch[k], v_f_out[k]);
                }

                for (int lane = 0; lane < 4; ++lane) {
                    int curr_x = x + lane;
                    int curr_idx = idx + lane;
                    
                    if (barriers[curr_idx]) {
                        rho[curr_idx] = 1.0f;
                        ux[curr_idx] = 0.0f;
                        uy[curr_idx] = 0.0f;
                        for(int k=0; k<9; ++k) f_new[k][curr_idx] = feq_rest[k];
                        continue;
                    }

                    for (int k = 0; k < 9; ++k) {
                        float val = f_out_batch[k][lane];
                        
                        int nx = curr_x + cx[k];
                        int ny = y + cy[k];
                        
                        int dest_x = nx;
                        int dest_y = ny;
                        int dest_k = k;
                        bool bounce = false;

                        switch(boundaryType) {
                            case 0: 
                                dest_x = (nx + w) % w;
                                dest_y = (ny + h) % h;
                                break;
                            case 1: 
                                if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
                                    bounce = true;
                                    dest_k = opp[k];
                                    dest_x = curr_x;
                                    dest_y = y;
                                }
                                break;
                            case 2: 
                                dest_x = (nx + w) % w;
                                if (ny < 0 || ny >= h) {
                                    bounce = true;
                                    dest_k = opp[k];
                                    dest_x = curr_x;
                                    dest_y = y;
                                }
                                break;
                            case 3: 
                                dest_y = (ny + h) % h;
                                if (nx < 0 || nx >= w) {
                                    bounce = true;
                                    dest_k = opp[k];
                                    dest_x = curr_x;
                                    dest_y = y;
                                }
                                break;
                            case 4: 
                                if (nx < 0 || nx >= w) {
                                    bounce = true;
                                    dest_k = slip_v[k]; 
                                    dest_x = curr_x;
                                    dest_y = y;
                                } else if (ny < 0 || ny >= h) {
                                    bounce = true;
                                    dest_k = slip_h[k]; 
                                    dest_x = curr_x;
                                    dest_y = y;
                                }
                                break;
                            case 5: 
                                dest_x = (nx + w) % w;
                                 if (ny < 0 || ny >= h) {
                                    bounce = true;
                                    dest_k = slip_h[k]; 
                                    dest_x = curr_x;
                                    dest_y = y;
                                }
                                break;
                        }

                        if (bounce) {
                            f_new[dest_k][curr_idx] = val;
                        } else {
                            int n_idx = dest_y * w + dest_x;
                            if (barriers[n_idx]) {
                                f_new[opp[k]][curr_idx] = val;
                            } else {
                                f_new[dest_k][n_idx] = val;
                            }
                        }
                    }
                }
            }

            for (; x < w; ++x) {
                int idx = y * w + x;
                
                if (barriers[idx]) {
                    rho[idx] = 1.0f;
                    ux[idx] = 0.0f;
                    uy[idx] = 0.0f;
                    
                    float feq[9];
                    equilibrium(1.0f, 0.0f, 0.0f, feq);
                    for(int k=0; k<9; ++k) {
                        f_new[k][idx] = feq[k];
                    }
                    continue;
                }

                float r = 0.0f;
                float u_val = 0.0f;
                float v_val = 0.0f;
                
                for (int k = 0; k < 9; ++k) {
                    float f_val = f[k][idx];
                    r += f_val;
                    u_val += f_val * cx[k];
                    v_val += f_val * cy[k];
                }
                
                if (r > 0) {
                    u_val /= r;
                    v_val /= r;
                }
                
                rho[idx] = r;

                float fx = gravityX + forceX[idx];
                float fy = gravityY + buoyancy * temperature[idx] + forceY[idx];
                
                float u_eq = u_val + fx * dt;
                float v_eq = v_val + fy * dt;
                
                if (velocityDissipation > 0.0f) {
                    float damp = 1.0f - velocityDissipation;
                    if (damp < 0.0f) damp = 0.0f;
                    u_eq *= damp;
                    v_eq *= damp;
                }

                limitVelocity(u_eq, v_eq);
                ux[idx] = u_eq;
                uy[idx] = v_eq;

                float feq[9];
                equilibrium(r, u_eq, v_eq, feq);

                for (int k = 0; k < 9; ++k) {
                    float f_out = f[k][idx] * (1.0f - omega) + feq[k] * omega;
                    
                    int nx = x + cx[k];
                    int ny = y + cy[k];
                    
                    int dest_x = nx;
                    int dest_y = ny;
                    int dest_k = k;
                    bool bounce = false;

                    switch(boundaryType) {
                        case 0: 
                            dest_x = (nx + w) % w;
                            dest_y = (ny + h) % h;
                            break;
                        case 1: 
                            if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
                                bounce = true;
                                dest_k = opp[k];
                                dest_x = x;
                                dest_y = y;
                            }
                            break;
                        case 2: 
                            dest_x = (nx + w) % w;
                            if (ny < 0 || ny >= h) {
                                bounce = true;
                                dest_k = opp[k];
                                dest_x = x;
                                dest_y = y;
                            }
                            break;
                        case 3: 
                            dest_y = (ny + h) % h;
                            if (nx < 0 || nx >= w) {
                                bounce = true;
                                dest_k = opp[k];
                                dest_x = x;
                                dest_y = y;
                            }
                            break;
                        case 4: 
                            if (nx < 0 || nx >= w) {
                                bounce = true;
                                dest_k = slip_v[k]; 
                                dest_x = x;
                                dest_y = y;
                            } else if (ny < 0 || ny >= h) {
                                bounce = true;
                                dest_k = slip_h[k]; 
                                dest_x = x;
                                dest_y = y;
                            }
                            break;
                        case 5: 
                            dest_x = (nx + w) % w;
                             if (ny < 0 || ny >= h) {
                                bounce = true;
                                dest_k = slip_h[k]; 
                                dest_x = x;
                                dest_y = y;
                            }
                            break;
                    }

                    if (bounce) {
                        f_new[dest_k][idx] = f_out;
                    } else {
                        int n_idx = dest_y * w + dest_x;
                        if (barriers[n_idx]) {
                            f_new[opp[k]][idx] = f_out;
                        } else {
                            f_new[dest_k][n_idx] = f_out;
                        }
                    }
                }
            }
        }
    });

    for (int k = 0; k < 9; ++k) {
        std::swap(f[k], f_new[k]);
    }

    if (vorticityConfinement > 0.0f) {
        std::fill(curl.begin(), curl.end(), 0.0f);

        parallel_for(1, h - 1, [&](int startY, int endY) {
            for (int y = startY; y < endY; ++y) {
                for (int x = 1; x < w - 1; ++x) {
                    int idx = y * w + x;
                    if (barriers[idx]) continue;
                    curl[idx] = uy[idx + 1] - uy[idx - 1] - (ux[idx + w] - ux[idx - w]);
                }
            }
        });
        
        parallel_for(1, h - 1, [&](int startY, int endY) {
            for (int y = startY; y < endY; ++y) {
                for (int x = 1; x < w - 1; ++x) {
                    int idx = y * w + x;
                    if (barriers[idx]) {
                        forceX[idx] = 0.0f;
                        forceY[idx] = 0.0f;
                        continue;
                    }
                    
                    float dc_dx = (std::abs(curl[idx + 1]) - std::abs(curl[idx - 1])) * 0.5f;
                    float dc_dy = (std::abs(curl[idx + w]) - std::abs(curl[idx - w])) * 0.5f;
                    float mag_grad = std::sqrt(dc_dx * dc_dx + dc_dy * dc_dy);
                    
                    if (mag_grad > 1e-6f) {
                        float scale = vorticityConfinement / mag_grad;
                        forceX[idx] = scale * dc_dy * curl[idx];
                        forceY[idx] = scale * -dc_dx * curl[idx];
                    } else {
                        forceX[idx] = 0.0f;
                        forceY[idx] = 0.0f;
                    }
                }
            }
        });
    } else {
        std::fill(forceX.begin(), forceX.end(), 0.0f);
        std::fill(forceY.begin(), forceY.end(), 0.0f);
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
        .function("applyGenericBrush", &FluidEngine::applyGenericBrush)
        .function("getDensityView", &FluidEngine::getDensityView)
        .function("getVelocityXView", &FluidEngine::getVelocityXView)
        .function("getVelocityYView", &FluidEngine::getVelocityYView)
        .function("getBarrierView", &FluidEngine::getBarrierView)
        .function("getDyeView", &FluidEngine::getDyeView)
        .function("getTemperatureView", &FluidEngine::getTemperatureView);
}