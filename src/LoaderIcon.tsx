import type { Loader } from "./types";
import { Cube } from "./Landscape";

export default function LoaderIcon({
  loader,
  size = 32,
}: {
  loader?: Loader;
  size?: number;
}) {
  if (!loader || loader === "vanilla") return <Cube size={size} />;
  if (loader === "fabric")
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        aria-label="Fabric 布料"
        role="img"
      >
        <path
          d="M10 8h21l-4 27H6L10 8Z"
          fill="#bba783"
          stroke="#635945"
          strokeWidth="1.4"
        />
        <path
          d="m13 4 20 3-5 25-20-3L13 4Z"
          fill="#e7d8b6"
          stroke="#71654e"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="m13 4-2 10 6-4 16-3-20-3Z" fill="#c7b38d" />
        <path
          d="m11 26 14 2 4-18"
          stroke="#9c8c6e"
          strokeWidth="1.2"
          strokeDasharray="2 2"
        />
        <path
          d="m16 15 10 1.5m-11 4 10 1.5"
          stroke="#c6b691"
          strokeWidth="1.2"
        />
      </svg>
    );
  if (loader === "forge")
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        aria-label="Forge 铁砧"
        role="img"
      >
        <path d="M4 10h31v5H4z" fill="#afc2cb" />
        <path
          d="M4 15h31l-7 7h-5v7h5l4 6H9l4-6h4v-7h-4L4 15Z"
          fill="#617681"
          stroke="#b5c8ce"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <path d="M2 13h12v6H9L2 13Z" fill="#8ba2ad" />
        <path d="M14 15h21l-7 7H17l-3-7Z" fill="#7e939d" />
        <path
          d="M13 29h15M11 33h18"
          stroke="#d3dfe2"
          strokeOpacity=".65"
          strokeWidth="1.2"
        />
        <path d="M6 11h26" stroke="#eff5f5" strokeWidth="1.2" />
      </svg>
    );
  if (loader === "neoforge")
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        aria-label="NeoForge 狐狸"
        role="img"
      >
        <path
          d="m5 4 12 8h6L35 4l-2 19-13 13L7 23 5 4Z"
          fill="#e58c47"
          stroke="#ffbc78"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <path d="m8 8 7 6-6 4-1-10Zm24 0-7 6 6 4 1-10Z" fill="#653a2b" />
        <path d="m7 21 9 3 4 8 4-8 9-3-5 10-8 5-8-5-5-10Z" fill="#fff0d4" />
        <path d="m17 29 3-2 3 2-3 4-3-4Z" fill="#392e29" />
        <path
          d="m12 20 4 1m8 0 4-1"
          stroke="#372b25"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path d="m20 12-3 10h6l-3-10Z" fill="#f9a957" />
      </svg>
    );
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-label="OptiFine"
      role="img"
    >
      <path d="m20 5 4 11 11 4-11 4-4 11-4-11-11-4 11-4 4-11Z" fill="#b1e1c5" />
      <path
        d="m31 3 1.7 4.3L37 9l-4.3 1.7L31 15l-1.7-4.3L25 9l4.3-1.7L31 3Z"
        fill="#80b99f"
      />
    </svg>
  );
}
