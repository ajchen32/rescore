#import "SlicerBridge.h"

#include "../cpp/slicer.h"

#import <ImageIO/ImageIO.h>
#import <UIKit/UIKit.h>

@implementation PppSliceRangeObj
@end

NSArray<PppSliceRangeObj *> *_Nullable ppp_slice_page_objc(
    const uint8_t *gray,
    int32_t width,
    int32_t height,
    int32_t stride) {
  PppSliceResult *result = ppp_slice_page(gray, width, height, stride);
  if (result == nullptr) {
    return nil;
  }

  NSMutableArray<PppSliceRangeObj *> *ranges = [NSMutableArray arrayWithCapacity:result->count];
  for (int32_t i = 0; i < result->count; ++i) {
    PppSliceRangeObj *obj = [[PppSliceRangeObj alloc] init];
    obj.x0 = result->ranges[i].x0;
    obj.y0 = result->ranges[i].y0;
    obj.x1 = result->ranges[i].x1;
    obj.y1 = result->ranges[i].y1;
    [ranges addObject:obj];
  }

  ppp_slice_result_free(result);
  return ranges;
}

BOOL ppp_write_png_strip(
    const uint8_t *gray,
    int32_t width,
    int32_t height,
    int32_t stride,
    int32_t x0,
    int32_t y0,
    int32_t x1,
    int32_t y1,
    NSString *path,
    int32_t *outWidth,
    int32_t *outHeight) {
  if (gray == nullptr || path == nil || x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0 || x1 > width || y1 > height) {
    return NO;
  }

  const int32_t stripWidth = x1 - x0;
  const int32_t stripHeight = y1 - y0;
  NSMutableData *data = [NSMutableData dataWithLength:static_cast<NSUInteger>(stripWidth) * stripHeight];
  uint8_t *dst = static_cast<uint8_t *>(data.mutableBytes);

  for (int32_t y = 0; y < stripHeight; ++y) {
    const uint8_t *srcRow = gray + static_cast<size_t>(y0 + y) * static_cast<size_t>(stride) + x0;
    memcpy(dst + static_cast<size_t>(y) * static_cast<size_t>(stripWidth), srcRow, static_cast<size_t>(stripWidth));
  }

  ppp_sharpen_strip(dst, stripWidth, stripHeight, stripWidth);

  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceGray();
  CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)data);
  CGImageRef image = CGImageCreate(
      stripWidth,
      stripHeight,
      8,
      8,
      stripWidth,
      colorSpace,
      kCGImageAlphaNone,
      provider,
      nullptr,
      false,
      kCGRenderingIntentDefault);

  CGDataProviderRelease(provider);
  CGColorSpaceRelease(colorSpace);

  if (image == nullptr) {
    return NO;
  }

  NSURL *url = [NSURL fileURLWithPath:path];
  CGImageDestinationRef destination = CGImageDestinationCreateWithURL(
      (__bridge CFURLRef)url,
      CFSTR("public.png"),
      1,
      nullptr);

  BOOL success = NO;
  if (destination != nullptr) {
    CGImageDestinationAddImage(destination, image, nullptr);
    success = CGImageDestinationFinalize(destination);
    CFRelease(destination);
  }

  CGImageRelease(image);

  if (success && outWidth != nullptr && outHeight != nullptr) {
    *outWidth = stripWidth;
    *outHeight = stripHeight;
  }

  return success;
}
