#import "SlicerBridge.h"

#include "../cpp/raster.h"
#include "../cpp/slicer.h"

#import <ImageIO/ImageIO.h>
#import <UIKit/UIKit.h>

#include <vector>

@implementation PppSliceRangeObj
@end

static BOOL write_gray_png(NSData *data, int32_t width, int32_t height, NSString *path) {
  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceGray();
  CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)data);
  CGImageRef image = CGImageCreate(
      width,
      height,
      8,
      8,
      width,
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
  return success;
}

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

  const BOOL success = write_gray_png(data, stripWidth, stripHeight, path);
  if (success && outWidth != nullptr && outHeight != nullptr) {
    *outWidth = stripWidth;
    *outHeight = stripHeight;
  }

  return success;
}

BOOL ppp_image_file_size(NSString *path, int32_t *outWidth, int32_t *outHeight) {
  if (path == nil || outWidth == nullptr || outHeight == nullptr) {
    return NO;
  }

  CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:path], nullptr);
  if (source == nullptr) {
    return NO;
  }
  NSDictionary *properties =
      (__bridge_transfer NSDictionary *)CGImageSourceCopyPropertiesAtIndex(source, 0, nullptr);
  CFRelease(source);

  NSNumber *width = properties[(__bridge NSString *)kCGImagePropertyPixelWidth];
  NSNumber *height = properties[(__bridge NSString *)kCGImagePropertyPixelHeight];
  if (width == nil || height == nil || width.intValue <= 0 || height.intValue <= 0) {
    return NO;
  }
  *outWidth = width.intValue;
  *outHeight = height.intValue;
  return YES;
}

BOOL ppp_resample_image_file(NSString *sourcePath, NSString *destinationPath, int32_t width, int32_t height) {
  if (sourcePath == nil || destinationPath == nil || width <= 0 || height <= 0) {
    return NO;
  }

  CGImageSourceRef source =
      CGImageSourceCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:sourcePath], nullptr);
  if (source == nullptr) {
    return NO;
  }
  CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, nullptr);
  CFRelease(source);
  if (image == nullptr) {
    return NO;
  }

  const int32_t sourceWidth = static_cast<int32_t>(CGImageGetWidth(image));
  const int32_t sourceHeight = static_cast<int32_t>(CGImageGetHeight(image));
  std::vector<uint8_t> gray(static_cast<size_t>(sourceWidth) * static_cast<size_t>(sourceHeight), 255);

  // Draw into an 8-bit gray context to get luminance regardless of the file's format.
  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceGray();
  CGContextRef context = CGBitmapContextCreate(
      gray.data(),
      sourceWidth,
      sourceHeight,
      8,
      sourceWidth,
      colorSpace,
      kCGImageAlphaNone);
  CGColorSpaceRelease(colorSpace);
  if (context == nullptr) {
    CGImageRelease(image);
    return NO;
  }
  CGContextDrawImage(context, CGRectMake(0, 0, sourceWidth, sourceHeight), image);
  CGContextRelease(context);
  CGImageRelease(image);

  NSMutableData *resized = [NSMutableData dataWithLength:static_cast<NSUInteger>(width) * height];
  ppp_area_resample(
      gray.data(),
      sourceWidth,
      sourceHeight,
      sourceWidth,
      static_cast<uint8_t *>(resized.mutableBytes),
      width,
      height);
  return write_gray_png(resized, width, height, destinationPath);
}
