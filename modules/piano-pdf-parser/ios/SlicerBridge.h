#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface PppSliceRangeObj : NSObject
@property(nonatomic, assign) int32_t x0;
@property(nonatomic, assign) int32_t y0;
@property(nonatomic, assign) int32_t x1;
@property(nonatomic, assign) int32_t y1;
@end

/// Slice an 8-bit grayscale page (0=black, 255=white). Returns nil on failure.
NSArray<PppSliceRangeObj *> *_Nullable ppp_slice_page_objc(
    const uint8_t *gray,
    int32_t width,
    int32_t height,
    int32_t stride);

/// Write rows [y0, y1) and columns [x0, x1) from a grayscale buffer to a PNG file.
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
    int32_t *outHeight);

NS_ASSUME_NONNULL_END
