# Slicer debug notes

## Smallest JS API to surface confidence later

Do not implement yet; sketch only.

```ts
type StripProvenance =
  | "brace"
  | "orphan_indent"
  | "leftover_staff"
  | "fallback_full_page";

type Strip = {
  pageIndex: number;
  y0: number;
  y1: number;
  imageUri: string;
  provenance?: StripProvenance;
  absorbed?: boolean;
  lowConfidence?: boolean;
};

type ProcessPdfResult = {
  strips: Strip[];
  garbage?: Strip[];
  debug?: {
    staffSpace?: number;
    lineThickness?: number;
  };
};
```

Expose provenance and `lowConfidence` only behind a dev flag initially. Production UI can show a subtle warning badge on `lowConfidence` strips and offer "review cut" in corrections.

Native side already tags strips in `ppp_slice_page_debug`. A future JNI/Swift debug bridge could map `PppTaggedSliceRange` fields without changing the default `ppp_slice_page` ABI.
