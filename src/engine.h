#pragma once
#include <vector>
#include <emscripten/bind.h>

class FluidEngine {
public:
    FluidEngine(int width, int height);
    void step(int iterations);
    void addForce(int x, int y, float fx, float fy);
    void setViscosity(float viscosity);
    void setDecay(float decay);
    
    void setBoundaryType(int type);
    void setDt(float dt);
    void setGravity(float gx, float gy);

    emscripten::val getDensityView();
    emscripten::val getVelocityXView();
    emscripten::val getVelocityYView();
    emscripten::val getBarrierView();
    emscripten::val getDyeView();

    void reset();
    void addDensity(int x, int y, float amount);
    void clearRegion(int x, int y, int radius);
    void addObstacle(int x, int y, int radius, bool remove);

private:
    int w, h;
    float omega; 
    float decay;
    float dt;
    int boundaryType;
    float gravityX;
    float gravityY;
    
    std::vector<float> f;     
    std::vector<float> f_new; 
    std::vector<float> rho;   
    std::vector<float> ux;    
    std::vector<float> uy;
    std::vector<unsigned char> barriers;
    std::vector<float> dye;
    std::vector<float> dye_new;

    void equilibrium(float r, float u, float v, float* feq);
    void collideAndStream();
    void advectDye();
    void limitVelocity(float &u, float &v);
};