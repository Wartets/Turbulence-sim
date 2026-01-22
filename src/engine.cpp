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

FluidEngine::FluidEngine(int width, int height)
    : w(width), h(height)
    , omega(1.85f)
    , decay(0.0f)
    , globalDrag(0.0f)
    , dt(1.0f)
    , boundaryLeft(1), boundaryRight(1), boundaryTop(1), boundaryBottom(1)
    , inflowVelocityX(0.0f), inflowVelocityY(0.0f)
    , inflowDensity(1.0f)
    , movingWallVelocityLeftX(0.0f), movingWallVelocityLeftY(0.0f)
    , movingWallVelocityRightX(0.0f), movingWallVelocityRightY(0.0f)
    , movingWallVelocityTopX(0.0f), movingWallVelocityTopY(0.0f)
    , movingWallVelocityBottomX(0.0f), movingWallVelocityBottomY(0.0f)
    , gravityX(0.0f), gravityY(0.0f)
    , thermalExpansion(0.0f)
    , referenceTemperature(0.0f)
    , thermalDiffusivity(0.0f)
    , vorticityConfinement(0.0f)
    , maxVelocity(0.57f)
    , smagorinskyConstant(0.0f)
    , temperatureViscosity(0.0f)
    , flowBehaviorIndex(1.0f)
    , consistencyIndex(0.0f)
    , porosityDrag(0.0f)
    , spongeStrength(0.0f)
    , spongeWidth(0)
    , spongeLeft(false), spongeRight(false)
    , spongeTop(false), spongeBottom(false)
    , threadCount(1), stop_pool(false)
    , pending_workers(0)
    , work_generation(0)
    , barriersDirty(true)
    , dataVersion(1)
    , useBFECC(false)
{
    std::cout << "DEBUG: FluidEngine Created (w="
              << width << ", h=" << height
              << "). Threading support initialized."
              << std::endl;

    int size = w * h;

    for (int k = 0; k < 9; ++k) {
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
    porosity.resize(size, 1.0f);
    tmp_bfecc1.resize(size, 0.0f);
    tmp_bfecc2.resize(size, 0.0f);

    forceX.resize(size, 0.0f);
    forceY.resize(size, 0.0f);
    curl.resize(size, 0.0f);

    float feq[9];
    equilibrium(1.0f, 0.0f, 0.0f, feq);

    for (int k = 0; k < 9; ++k) {
        std::fill(f[k].begin(), f[k].end(), feq[k]);
    }
}

void FluidEngine::setBFECC(bool enable) {
    useBFECC = enable;
}

void FluidEngine::performAdvection(const std::vector<float>& src, std::vector<float>& dst, float dt_scale, float decay_rate) {
    parallel_for(0, h, [&](int startY, int endY) {
        const int BLOCK_SIZE = 32;
        for (int by = startY; by < endY; by += BLOCK_SIZE) {
            int maxY = std::min(by + BLOCK_SIZE, endY);
            for (int bx = 0; bx < w; bx += BLOCK_SIZE) {
                int maxX = std::min(bx + BLOCK_SIZE, w);
                
                for (int y = by; y < maxY; ++y) {
                    for (int x = bx; x < maxX; ++x) {
                        int idx = y * w + x;
                        if (barriers[idx]) {
                            dst[idx] = 0.0f;
                            continue;
                        }

                        float x_prev = (float)x - ux[idx] * dt_scale;
                        float y_prev = (float)y - uy[idx] * dt_scale;

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

                        float d_tl = barriers[idx_tl] ? 0.0f : src[idx_tl];
                        float d_tr = barriers[idx_tr] ? 0.0f : src[idx_tr];
                        float d_bl = barriers[idx_bl] ? 0.0f : src[idx_bl];
                        float d_br = barriers[idx_br] ? 0.0f : src[idx_br];
                        
                        float interpolated = (1.0f - fx) * (1.0f - fy) * d_tl +
                                             fx * (1.0f - fy) * d_tr +
                                             (1.0f - fx) * fy * d_bl +
                                             fx * fy * d_br;
                        
                        dst[idx] = interpolated * (1.0f - decay_rate);
                    }
                }
            }
        }
    });
}

void FluidEngine::setBoundaryConditions(int left, int right, int top, int bottom) {
    boundaryLeft = left;
    boundaryRight = right;
    boundaryTop = top;
    boundaryBottom = bottom;
}

void FluidEngine::setInflowProperties(float vx, float vy, float rho) {
    inflowVelocityX = vx;
    inflowVelocityY = vy;
    inflowDensity = rho;
}

void FluidEngine::setMovingWallVelocity(int side, float vx, float vy) {
    switch (side) {
        case 0: movingWallVelocityLeftX = vx; movingWallVelocityLeftY = vy; break;
        case 1: movingWallVelocityRightX = vx; movingWallVelocityRightY = vy; break;
        case 2: movingWallVelocityTopX = vx; movingWallVelocityTopY = vy; break;
        case 3: movingWallVelocityBottomX = vx; movingWallVelocityBottomY = vy; break;
    }
}

void FluidEngine::applyMacroscopicBoundaries() {
    float feq[9];
    if (boundaryLeft == 4) {
        for (int y = 0; y < h; ++y) {
            int idx = y * w + 0;
            if (barriers[idx]) continue;
            equilibrium(inflowDensity, inflowVelocityX, inflowVelocityY, feq);
            for(int k = 0; k < 9; ++k) f[k][idx] = feq[k];
        }
    }
    if (boundaryRight == 4) {
        for (int y = 0; y < h; ++y) {
            int idx = y * w + (w - 1);
            if (barriers[idx]) continue;
            equilibrium(inflowDensity, inflowVelocityX, inflowVelocityY, feq);
            for(int k = 0; k < 9; ++k) f[k][idx] = feq[k];
        }
    }
    if (boundaryBottom == 4) {
        for (int x = 0; x < w; ++x) {
            int idx = 0 * w + x;
            if (barriers[idx]) continue;
            equilibrium(inflowDensity, inflowVelocityX, inflowVelocityY, feq);
            for(int k = 0; k < 9; ++k) f[k][idx] = feq[k];
        }
    }
    if (boundaryTop == 4) {
        for (int x = 0; x < w; ++x) {
            int idx = (h - 1) * w + x;
            if (barriers[idx]) continue;
            equilibrium(inflowDensity, inflowVelocityX, inflowVelocityY, feq);
            for(int k = 0; k < 9; ++k) f[k][idx] = feq[k];
        }
    }
}

void FluidEngine::applyPostStreamBoundaries() {
    if (boundaryLeft == 5) {
        for (int y = 0; y < h; ++y) {
            int idx = y * w + 0;
            if(barriers[idx]) continue;
            for (int k = 0; k < 9; ++k) f[k][idx] = f[k][idx + 1];
        }
    }
    if (boundaryRight == 5) {
        for (int y = 0; y < h; ++y) {
            int idx = y * w + (w - 1);
            if(barriers[idx]) continue;
            for (int k = 0; k < 9; ++k) f[k][idx] = f[k][idx - 1];
        }
    }
    if (boundaryBottom == 5) {
        for (int x = 0; x < w; ++x) {
            int idx = 0 * w + x;
            if(barriers[idx]) continue;
            for (int k = 0; k < 9; ++k) f[k][idx] = f[k][idx + w];
        }
    }
    if (boundaryTop == 5) {
        for (int x = 0; x < w; ++x) {
            int idx = (h - 1) * w + x;
            if(barriers[idx]) continue;
            for (int k = 0; k < 9; ++k) f[k][idx] = f[k][idx - w];
        }
    }
}

unsigned int FluidEngine::getDataVersion() {
    return dataVersion.load();
}

void FluidEngine::setFlowBehaviorIndex(float n) {
    flowBehaviorIndex = n;
}

void FluidEngine::setConsistencyIndex(float k) {
    consistencyIndex = k;
}

void FluidEngine::setSmagorinskyConstant(float c) {
    smagorinskyConstant = c;
}

void FluidEngine::setTemperatureViscosity(float v) {
    temperatureViscosity = v;
}

bool FluidEngine::checkBarrierDirty() {
    return barriersDirty.exchange(false);
}

FluidEngine::~FluidEngine() {
    stop_pool = true;
    worker_cv.notify_all();
    for (std::thread &worker : workers) {
        if (worker.joinable()) {
            worker.join();
        }
    }
}

void FluidEngine::initThreadPool(int count) {
    #ifdef __EMSCRIPTEN_PTHREADS__
        for(int i = 0; i < count; ++i) {
            workers.emplace_back([this, i] {
                int my_generation = 0;
                while(true) {
                    std::function<void(int, int)> task;
                    int start, end;
                    
                    {
                        std::unique_lock<std::mutex> lock(worker_mutex);
                        worker_cv.wait(lock, [this, my_generation]{ 
                            return stop_pool || work_generation > my_generation; 
                        });
                        
                        if(stop_pool) return;
                        
                        task = current_task;
                        start = task_start;
                        end = task_end;
                        my_generation = work_generation;
                    }
                    
                    int total_range = end - start;
                    int chunk = total_range / threadCount;
                    int r_start = start + i * chunk;
                    int r_end = (i == threadCount - 1) ? end : r_start + chunk;
                    
                    task(r_start, r_end);
                    
                    if(pending_workers.fetch_sub(1) == 1) {
                        std::lock_guard<std::mutex> lock(worker_mutex);
                        main_cv.notify_one();
                    }
                }
            });
        }
    #endif
}

void FluidEngine::setThreadCount(int count) {
    std::cout << "DEBUG: setThreadCount called with " << count << std::endl;
    int newCount = std::max(1, count);
    
    if (newCount == threadCount && !workers.empty()) return;

    stop_pool = true;
    worker_cv.notify_all();
    for(std::thread &worker : workers) {
        if(worker.joinable()) worker.join();
    }
    workers.clear();

    threadCount = newCount;
    stop_pool = false;
    work_generation = 0;
    
    if (threadCount > 1) {
        initThreadPool(threadCount);
    }
}

void FluidEngine::parallel_for(int start, int end, std::function<void(int, int)> func) {
    if (threadCount <= 1) {
        func(start, end);
    } else {
        #ifdef __EMSCRIPTEN_PTHREADS__
            {
                std::lock_guard<std::mutex> lock(worker_mutex);
                current_task = func;
                task_start = start;
                task_end = end;
                pending_workers = threadCount;
                work_generation++;
            }
            worker_cv.notify_all();
            
            std::unique_lock<std::mutex> lock(worker_mutex);
            main_cv.wait(lock, [this]{ return pending_workers == 0; });
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

void FluidEngine::setDt(float newDt) {
    dt = newDt;
}

void FluidEngine::setGravity(float gx, float gy) {
    gravityX = gx;
    gravityY = gy;
}

void FluidEngine::setThermalProperties(float expansion, float refTemp) {
    thermalExpansion = expansion;
    referenceTemperature = refTemp;
}

void FluidEngine::setThermalDiffusivity(float td) {
    thermalDiffusivity = td;
}

void FluidEngine::setVorticityConfinement(float vc) {
    vorticityConfinement = vc;
}

void FluidEngine::setGlobalDrag(float drag) {
    globalDrag = drag;
}

void FluidEngine::setPorosityDrag(float drag) {
    porosityDrag = drag;
}

void FluidEngine::setSpongeProperties(float strength, int width) {
    spongeStrength = strength;
    spongeWidth = width;
}

void FluidEngine::setSpongeBoundaries(bool left, bool right, bool top, bool bottom) {
    spongeLeft = left;
    spongeRight = right;
    spongeTop = top;
    spongeBottom = bottom;
}

val FluidEngine::getPorosityView() {
    return val(typed_memory_view(w * h, porosity.data()));
}

void FluidEngine::applyPorosityBrush(int x, int y, int radius, float strength, bool add, float falloffParam, float angle, float aspectRatio, int shape, int falloffMode) {
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
                dist = (std::abs(rx) + std::abs(ry)) * 0.7071f;
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

            float change = strength * weight;
            porosity[idx] += add ? change : -change;
            if (porosity[idx] > 1.0f) porosity[idx] = 1.0f;
            if (porosity[idx] < 0.0f) porosity[idx] = 0.0f;
        }
    }
    dataVersion++;
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
    dataVersion++;
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
    dataVersion++;
}

void FluidEngine::addTemperature(int x, int y, float amount) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    int idx = y * w + x;
    
    if (barriers[idx]) return;

    temperature[idx] += amount;
    dataVersion++;
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
    dataVersion++;
}

void FluidEngine::addDensity(int x, int y, float amount) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    int idx = y * w + x;
    
    if (barriers[idx]) return;

    dye[idx] += amount;
    dataVersion++;
}

void FluidEngine::addObstacle(int x, int y, int radius, bool remove, float angle, float aspectRatio, int shape) {
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
    barriersDirty.store(true);
    dataVersion++;
}

void FluidEngine::reset() {
    int size = w * h;
    std::fill(rho.begin(), rho.end(), 1.0f);
    std::fill(ux.begin(), ux.end(), 0.0f);
    std::fill(uy.begin(), uy.end(), 0.0f);
    std::fill(barriers.begin(), barriers.end(), 0);
    std::fill(dye.begin(), dye.end(), 0.0f);
    std::fill(temperature.begin(), temperature.end(), 0.0f);
    std::fill(porosity.begin(), porosity.end(), 1.0f);

    float feq[9];
    equilibrium(1.0f, 0.0f, 0.0f, feq);

    for (int k = 0; k < 9; ++k) {
        std::fill(f[k].begin(), f[k].end(), feq[k]);
    }
    barriersDirty.store(true);
    dataVersion++;
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
    barriersDirty.store(true);
    dataVersion++;
}

void FluidEngine::step(int iterations) {
    for(int i=0; i<iterations; ++i) {
        applyMacroscopicBoundaries();
        collideAndStream();
        applyPostStreamBoundaries();
        advectDye();
        advectTemperature();
    }
    dataVersion++;
}

void FluidEngine::collideAndStream() {
    parallel_for(0, h, [&](int startY, int endY) {
        float feq_rest[9];
        equilibrium(1.0f, 0.0f, 0.0f, feq_rest);

        bool useSmagorinsky = (smagorinskyConstant > 0.0f);
        bool useTempVisc = (temperatureViscosity > 0.0f);
        bool useNonNewtonian = (consistencyIndex > 0.0f);
        float n_idx_val = flowBehaviorIndex;
        float k_idx_val = consistencyIndex;

        for (int y = startY; y < endY; ++y) {
            for (int x = 0; x < w; ++x) {
                int idx = y * w + x;
                if (barriers[idx]) {
                    rho[idx] = 1.0f;
                    ux[idx] = 0.0f;
                    uy[idx] = 0.0f;
                    for(int k=0; k<9; ++k) f_new[k][idx] = feq_rest[k];
                    continue;
                }

                float r = 0.0f, u_val = 0.0f, v_val = 0.0f;
                for (int k = 0; k < 9; ++k) {
                    float f_val = f[k][idx];
                    r += f_val;
                    u_val += f_val * cx[k];
                    v_val += f_val * cy[k];
                }
                if (r > 0) { u_val /= r; v_val /= r; }
                rho[idx] = r;

                float fx = gravityX + forceX[idx];
                float fy = gravityY + forceY[idx];
                
                if (thermalExpansion != 0.0f) {
                    fy += gravityY * thermalExpansion * (temperature[idx] - referenceTemperature);
                }

                float u_eq = u_val + fx * dt;
                float v_eq = v_val + fy * dt;
                
                float total_drag = globalDrag + porosityDrag * (1.0f - porosity[idx]);
                if (total_drag > 0.0f) {
                    float damp = 1.0f - total_drag;
                    if (damp < 0.0f) damp = 0.0f;
                    u_eq *= damp;
                    v_eq *= damp;
                }

                if (spongeWidth > 0 && spongeStrength > 0.0f) {
                    float damping = 0.0f;
                    float dist = -1.0f;
                    
                    if(spongeLeft && x < spongeWidth) dist = x;
                    else if(spongeRight && x >= w - spongeWidth) dist = w - 1 - x;
                    else if(spongeBottom && y < spongeWidth) dist = y;
                    else if(spongeTop && y >= h - spongeWidth) dist = h - 1 - y;

                    if (dist >= 0.0f) {
                        float ramp = 1.0f - dist / (float)spongeWidth;
                        damping = spongeStrength * ramp * ramp;
                    }
                    
                    if (damping > 0.0f) {
                        if (damping > 1.0f) damping = 1.0f;
                        u_eq *= (1.0f - damping);
                        v_eq *= (1.0f - damping);
                    }
                }

                limitVelocity(u_eq, v_eq);
                ux[idx] = u_eq;
                uy[idx] = v_eq;

                float feq[9];
                equilibrium(r, u_eq, v_eq, feq);

                float local_omega = omega;
                if (useTempVisc || useSmagorinsky || useNonNewtonian) {
                    float current_tau = 1.0f / omega;
                    float nu = (current_tau - 0.5f) / 3.0f;

                    if (useTempVisc) {
                        float T = temperature[idx];
                        nu = nu * (1.0f / (1.0f + temperatureViscosity * T));
                    }
                    
                    float magS = 0.0f;
                    if (useSmagorinsky || useNonNewtonian) {
                        float Qxx = 0.0f, Qxy = 0.0f, Qyy = 0.0f;
                        for(int k=0; k<9; ++k) {
                            float f_neq = f[k][idx] - feq[k];
                            Qxx += cx[k] * cx[k] * f_neq;
                            Qxy += cx[k] * cy[k] * f_neq;
                            Qyy += cy[k] * cy[k] * f_neq;
                        }
                        magS = std::sqrt(Qxx*Qxx + 2.0f*Qxy*Qxy + Qyy*Qyy);
                    }

                    if (useNonNewtonian) {
                        float strainMag = magS * 1.5f * omega; 
                        float viscosityFactor = 1.0f + k_idx_val * std::pow(strainMag, n_idx_val - 1.0f);
                        nu *= viscosityFactor;
                    }

                    if (useSmagorinsky) {
                        float eddy_nu = (smagorinskyConstant * smagorinskyConstant) * magS;
                        nu += eddy_nu;
                    }

                    float tau_eff = 3.0f * nu + 0.5f;
                    local_omega = 1.0f / tau_eff;
                    if(local_omega < 0.05f) local_omega = 0.05f;
                    if(local_omega > 1.95f) local_omega = 1.95f;
                }

                for (int k = 0; k < 9; ++k) {
                    float f_out = f[k][idx] * (1.0f - local_omega) + feq[k] * local_omega;
                    int nx = x + cx[k];
                    int ny = y + cy[k];

                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        int n_idx = ny * w + nx;
                        if (barriers[n_idx]) {
                            f_new[opp[k]][idx] = f_out;
                        } else {
                            f_new[k][n_idx] = f_out;
                        }
                    } else {
                        int dest_k = opp[k];
                        float f_bounce = f_out;
                        bool periodic_x = false;
                        bool periodic_y = false;
                        int final_nx = nx;
                        int final_ny = ny;
                        
                        if (nx < 0 && boundaryLeft == 0) { periodic_x = true; final_nx = w - 1; }
                        else if (nx >= w && boundaryRight == 0) { periodic_x = true; final_nx = 0; }
                        
                        if (ny < 0 && boundaryBottom == 0) { periodic_y = true; final_ny = h - 1; }
                        else if (ny >= h && boundaryTop == 0) { periodic_y = true; final_ny = 0; }

                        if (periodic_x || periodic_y) {
                            f_new[k][final_ny * w + final_nx] = f_bounce;
                            continue;
                        }

                        if (nx < 0) {
                            if (boundaryLeft == 2) dest_k = slip_v[k];
                            else if (boundaryLeft == 3) {
                                float wall_term = 6.0f * weights[k] * rho[idx] * (cx[k] * movingWallVelocityLeftX + cy[k] * movingWallVelocityLeftY);
                                f_bounce += wall_term;
                            }
                        } else if (nx >= w) {
                            if (boundaryRight == 2) dest_k = slip_v[k];
                            else if (boundaryRight == 3) {
                                float wall_term = 6.0f * weights[k] * rho[idx] * (cx[k] * movingWallVelocityRightX + cy[k] * movingWallVelocityRightY);
                                f_bounce += wall_term;
                            }
                        } else if (ny < 0) {
                            if (boundaryBottom == 2) dest_k = slip_h[k];
                            else if (boundaryBottom == 3) {
                                float wall_term = 6.0f * weights[k] * rho[idx] * (cx[k] * movingWallVelocityBottomX + cy[k] * movingWallVelocityBottomY);
                                f_bounce += wall_term;
                            }
                        } else if (ny >= h) {
                            if (boundaryTop == 2) dest_k = slip_h[k];
                            else if (boundaryTop == 3) {
                                float wall_term = 6.0f * weights[k] * rho[idx] * (cx[k] * movingWallVelocityTopX + cy[k] * movingWallVelocityTopY);
                                f_bounce += wall_term;
                            }
                        }

                        bool slip_corner = ( ( (nx < 0 && boundaryLeft == 2) || (nx >= w && boundaryRight == 2) ) &&
                                             ( (ny < 0 && boundaryBottom == 2) || (ny >= h && boundaryTop == 2) ) );
                        if (slip_corner) dest_k = opp[k];

                        f_new[dest_k][idx] = f_bounce;
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

val FluidEngine::getDyeView() {
    return val(typed_memory_view(w * h, dye.data()));
}

void FluidEngine::advectDye() {
    if (!useBFECC) {
        performAdvection(dye, dye_new, dt, decay);
    } else {
        performAdvection(dye, tmp_bfecc1, dt, 0.0f);
        performAdvection(tmp_bfecc1, tmp_bfecc2, -dt, 0.0f);

        parallel_for(0, h, [&](int startY, int endY) {
            for (int y = startY; y < endY; ++y) {
                for (int x = 0; x < w; ++x) {
                    int idx = y * w + x;
                    if (!barriers[idx]) {
                        float v = 1.5f * dye[idx] - 0.5f * tmp_bfecc2[idx];
                        if (v < 0.0f) v = 0.0f;
                        tmp_bfecc1[idx] = v;
                    }
                }
            }
        });

        performAdvection(tmp_bfecc1, dye_new, dt, decay);
    }
    dye.swap(dye_new);
}

void FluidEngine::advectTemperature() {
    if (!useBFECC) {
        performAdvection(temperature, temperature_new, dt, thermalDiffusivity);
    } else {
        performAdvection(temperature, tmp_bfecc1, dt, 0.0f);
        performAdvection(tmp_bfecc1, tmp_bfecc2, -dt, 0.0f);

        parallel_for(0, h, [&](int startY, int endY) {
            for (int y = startY; y < endY; ++y) {
                for (int x = 0; x < w; ++x) {
                    int idx = y * w + x;
                    if (!barriers[idx]) {
                        tmp_bfecc1[idx] = 1.5f * temperature[idx] - 0.5f * tmp_bfecc2[idx];
                    }
                }
            }
        });

        performAdvection(tmp_bfecc1, temperature_new, dt, thermalDiffusivity);
    }
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
        .function("setFlowBehaviorIndex", &FluidEngine::setFlowBehaviorIndex)
        .function("setConsistencyIndex", &FluidEngine::setConsistencyIndex)
        .function("setDecay", &FluidEngine::setDecay)
        .function("setGlobalDrag", &FluidEngine::setGlobalDrag)
        .function("setDt", &FluidEngine::setDt)
        .function("setGravity", &FluidEngine::setGravity)
        .function("setBoundaryConditions", &FluidEngine::setBoundaryConditions)
        .function("setInflowProperties", &FluidEngine::setInflowProperties)
        .function("setMovingWallVelocity", &FluidEngine::setMovingWallVelocity)
        .function("setThermalProperties", &FluidEngine::setThermalProperties)
        .function("setThermalDiffusivity", &FluidEngine::setThermalDiffusivity)
        .function("setVorticityConfinement", &FluidEngine::setVorticityConfinement)
        .function("setMaxVelocity", &FluidEngine::setMaxVelocity)
        .function("setSmagorinskyConstant", &FluidEngine::setSmagorinskyConstant)
        .function("setTemperatureViscosity", &FluidEngine::setTemperatureViscosity)
        .function("setPorosityDrag", &FluidEngine::setPorosityDrag)
        .function("setSpongeProperties", &FluidEngine::setSpongeProperties)
        .function("setSpongeBoundaries", &FluidEngine::setSpongeBoundaries)
        .function("setBFECC", &FluidEngine::setBFECC)
        .function("reset", &FluidEngine::reset)
        .function("clearRegion", &FluidEngine::clearRegion)
        .function("addObstacle", emscripten::select_overload<void(int, int, int, bool, float, float, int)>(&FluidEngine::addObstacle))
        .function("applyDimensionalBrush", &FluidEngine::applyDimensionalBrush)
        .function("applyGenericBrush", &FluidEngine::applyGenericBrush)
        .function("applyPorosityBrush", &FluidEngine::applyPorosityBrush)
        .function("getDataVersion", &FluidEngine::getDataVersion)
        .function("getDensityView", &FluidEngine::getDensityView)
        .function("getVelocityXView", &FluidEngine::getVelocityXView)
        .function("getVelocityYView", &FluidEngine::getVelocityYView)
        .function("getBarrierView", &FluidEngine::getBarrierView)
        .function("getDyeView", &FluidEngine::getDyeView)
        .function("getTemperatureView", &FluidEngine::getTemperatureView)
        .function("getPorosityView", &FluidEngine::getPorosityView)
        .function("checkBarrierDirty", &FluidEngine::checkBarrierDirty);
}