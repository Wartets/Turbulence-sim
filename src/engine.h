#pragma once
#include <vector>
#include <thread>
#include <functional>
#include <emscripten/bind.h>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <atomic>
#include <future>

class FluidEngine {
public:
    FluidEngine(int width, int height);
    ~FluidEngine();
    void step(int iterations);
    void addForce(int x, int y, float fx, float fy);
    void setViscosity(float viscosity);
    void setDecay(float decay);
    void setVelocityDissipation(float dissipation);
    
    void setBoundaryType(int type);
    void setDt(float dt);
    void setGravity(float gx, float gy);
    void setBuoyancy(float b);
    void setThermalDiffusivity(float td);
    void setVorticityConfinement(float vc);
    void setMaxVelocity(float mv);
    
    void setThreadCount(int count);

    emscripten::val getDensityView();
    emscripten::val getVelocityXView();
    emscripten::val getVelocityYView();
    emscripten::val getBarrierView();
    emscripten::val getDyeView();
    emscripten::val getTemperatureView();

    void reset();
    void addDensity(int x, int y, float amount);
    void addTemperature(int x, int y, float amount);
    void clearRegion(int x, int y, int radius);
    void addObstacle(int x, int y, int radius, bool remove, float angle, float aspectRatio, int shape);
    void applyDimensionalBrush(int x, int y, int radius, int mode, float strength, float falloff, float angle, float aspectRatio, int shape, int falloffMode);
    void applyGenericBrush(int x, int y, int radius, float fx, float fy, float densityAmt, float tempAmt, float falloff, float angle, float aspectRatio, int shape, int falloffMode);
    
    bool checkBarrierDirty();

private:
    int w, h;
    float omega; 
    float decay;
    float velocityDissipation;
    float dt;
    int boundaryType;
    float gravityX;
    float gravityY;
    float buoyancy;
    float thermalDiffusivity;
    float vorticityConfinement;
    float maxVelocity;
    int threadCount;
    
    std::vector<float> f[9];     
    std::vector<float> f_new[9]; 
    std::vector<float> rho;   
    std::vector<float> ux;    
    std::vector<float> uy;
    std::vector<unsigned char> barriers;
    std::vector<float> dye;
    std::vector<float> dye_new;
    std::vector<float> temperature;
    std::vector<float> temperature_new;
    
    std::vector<float> forceX;
    std::vector<float> forceY;
    std::vector<float> curl;

    std::vector<std::thread> workers;
    std::mutex worker_mutex;
    std::condition_variable worker_cv;
    std::condition_variable main_cv;
    std::atomic<bool> stop_pool;
    std::atomic<int> pending_workers;
    int work_generation;
    
    std::function<void(int, int)> current_task;
    int task_start;
    int task_end;
    
    std::atomic<bool> barriersDirty;

    void initThreadPool(int count);

    void equilibrium(float r, float u, float v, float* feq);
    void collideAndStream();
    void advectDye();
    void advectTemperature();
    void limitVelocity(float &u, float &v);
    
    void parallel_for(int start, int end, std::function<void(int, int)> func);
};