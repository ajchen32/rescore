#include "gray_png.h"

#include <zlib.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {

void put_u32(std::vector<uint8_t>& out, uint32_t value) {
  out.push_back(static_cast<uint8_t>(value >> 24));
  out.push_back(static_cast<uint8_t>(value >> 16));
  out.push_back(static_cast<uint8_t>(value >> 8));
  out.push_back(static_cast<uint8_t>(value));
}

void put_chunk(std::vector<uint8_t>& out, const char type[4], const uint8_t* data, size_t length) {
  put_u32(out, static_cast<uint32_t>(length));
  const size_t type_offset = out.size();
  out.insert(out.end(), type, type + 4);
  if (length > 0) {
    out.insert(out.end(), data, data + length);
  }
  const uLong crc = crc32(0L, out.data() + type_offset, static_cast<uInt>(4 + length));
  put_u32(out, static_cast<uint32_t>(crc));
}

uint8_t paeth(int a, int b, int c) {
  const int p = a + b - c;
  const int pa = std::abs(p - a);
  const int pb = std::abs(p - b);
  const int pc = std::abs(p - c);
  if (pa <= pb && pa <= pc) {
    return static_cast<uint8_t>(a);
  }
  return static_cast<uint8_t>(pb <= pc ? b : c);
}

// Filters one row with each PNG filter type and keeps the one with the smallest
// sum of absolute values (the libpng heuristic); writes filter byte + row.
void filter_row(const uint8_t* row, const uint8_t* prev, int32_t width, uint8_t* out, std::vector<uint8_t>& scratch) {
  scratch.resize(static_cast<size_t>(width) * 5);
  uint8_t* candidates[5];
  for (int f = 0; f < 5; ++f) {
    candidates[f] = scratch.data() + static_cast<size_t>(f) * width;
  }

  for (int32_t x = 0; x < width; ++x) {
    const int a = x > 0 ? row[x - 1] : 0;
    const int b = prev != nullptr ? prev[x] : 0;
    const int c = (prev != nullptr && x > 0) ? prev[x - 1] : 0;
    const int v = row[x];
    candidates[0][x] = static_cast<uint8_t>(v);
    candidates[1][x] = static_cast<uint8_t>(v - a);
    candidates[2][x] = static_cast<uint8_t>(v - b);
    candidates[3][x] = static_cast<uint8_t>(v - ((a + b) >> 1));
    candidates[4][x] = static_cast<uint8_t>(v - paeth(a, b, c));
  }

  int best = 0;
  uint64_t best_cost = UINT64_MAX;
  for (int f = 0; f < 5; ++f) {
    uint64_t cost = 0;
    for (int32_t x = 0; x < width; ++x) {
      const int8_t signed_value = static_cast<int8_t>(candidates[f][x]);
      cost += static_cast<uint64_t>(std::abs(static_cast<int>(signed_value)));
    }
    if (cost < best_cost) {
      best_cost = cost;
      best = f;
    }
  }

  out[0] = static_cast<uint8_t>(best);
  std::memcpy(out + 1, candidates[best], static_cast<size_t>(width));
}

}  // namespace

bool write_gray_png(
    const char* path,
    const uint8_t* gray,
    int32_t width,
    int32_t height,
    int32_t stride,
    int compression_level) {
  if (path == nullptr || gray == nullptr || width <= 0 || height <= 0 || stride < width) {
    return false;
  }

  const size_t row_bytes = static_cast<size_t>(width) + 1;
  std::vector<uint8_t> filtered(row_bytes * static_cast<size_t>(height));
  std::vector<uint8_t> scratch;
  for (int32_t y = 0; y < height; ++y) {
    const uint8_t* row = gray + static_cast<size_t>(y) * static_cast<size_t>(stride);
    const uint8_t* prev = y > 0 ? row - stride : nullptr;
    filter_row(row, prev, width, filtered.data() + static_cast<size_t>(y) * row_bytes, scratch);
  }

  uLongf compressed_size = compressBound(static_cast<uLong>(filtered.size()));
  std::vector<uint8_t> compressed(compressed_size);
  if (compress2(compressed.data(), &compressed_size, filtered.data(),
                static_cast<uLong>(filtered.size()), compression_level) != Z_OK) {
    return false;
  }

  std::vector<uint8_t> png;
  png.reserve(compressed_size + 64);
  static const uint8_t kSignature[8] = {0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};
  png.insert(png.end(), kSignature, kSignature + 8);

  std::vector<uint8_t> header;
  put_u32(header, static_cast<uint32_t>(width));
  put_u32(header, static_cast<uint32_t>(height));
  header.push_back(8);  // bit depth
  header.push_back(0);  // color type: grayscale
  header.push_back(0);  // compression
  header.push_back(0);  // filter method
  header.push_back(0);  // no interlace
  put_chunk(png, "IHDR", header.data(), header.size());
  put_chunk(png, "IDAT", compressed.data(), compressed_size);
  put_chunk(png, "IEND", nullptr, 0);

  FILE* file = std::fopen(path, "wb");
  if (file == nullptr) {
    return false;
  }
  const bool written = std::fwrite(png.data(), 1, png.size(), file) == png.size();
  return std::fclose(file) == 0 && written;
}
