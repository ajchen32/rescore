// Times ppp_slice_page (the production entry point) on each page image and
// prints the strips it returns.
// Usage: slicer_bench <iterations> <page.png>...
// Output per page: path median_ms count then x0 y0 x1 y1 for each strip.
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"
#include "slicer.h"
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <vector>
int main(int argc, char** argv) {
  const int iters = std::atoi(argv[1]);
  for (int a = 2; a < argc; ++a) {
    int w, h, c;
    uint8_t* img = stbi_load(argv[a], &w, &h, &c, 1);
    if (!img) { std::fprintf(stderr, "load fail %s\n", argv[a]); continue; }
    std::vector<double> ms;
    PppSliceResult* keep = nullptr;
    for (int i = 0; i < iters; ++i) {
      auto t0 = std::chrono::steady_clock::now();
      PppSliceResult* r = ppp_slice_page(img, w, h, w);
      auto t1 = std::chrono::steady_clock::now();
      ms.push_back(std::chrono::duration<double, std::milli>(t1 - t0).count());
      if (keep) ppp_slice_result_free(keep);
      keep = r;
    }
    std::sort(ms.begin(), ms.end());
    std::printf("%s %.2f %d", argv[a], ms[ms.size() / 2], keep ? keep->count : -1);
    for (int i = 0; keep && i < keep->count; ++i) std::printf(" %d %d %d %d", keep->ranges[i].x0, keep->ranges[i].y0, keep->ranges[i].x1, keep->ranges[i].y1);
    std::printf("\n");
    ppp_slice_result_free(keep);
    stbi_image_free(img);
  }
}
