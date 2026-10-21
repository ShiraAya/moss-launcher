export function Cube({ size = 38 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 44"
      fill="none"
      aria-hidden="true"
    >
      <path d="M20 2 38 12 20 22 2 12Z" fill="#bde998" />
      <path d="m2 12 18 10v20L2 32Z" fill="#77ad67" />
      <path d="m20 22 18-10v20L20 42Z" fill="#4b7849" />
      <path d="m9 16 6 3v7l-6-3Zm14 10 8-4v7l-8 4Z" fill="#1e3526" />
    </svg>
  );
}
export default function Landscape() {
  const blocks = [];
  const trees = [];
  const rand = (a: number, b: number) =>
    Math.abs(Math.sin(a * 127.1 + b * 311.7) * 43758.5453) % 1;
  for (let z = 0; z < 18; z++)
    for (let x = 0; x < 22; x++) {
      const px = 625 + (x - z) * 23,
        py = 130 + (x + z) * 10;
      const river = Math.abs(x - 9 - Math.sin(z * 0.35) * 3) < 2;
      const h = river
        ? 9
        : Math.max(
            1,
            Math.round(
              2 + Math.sin(x * 0.38 + z * 0.22) * 1.4 + Math.cos(z * 0.4) * 1.3,
            ),
          ) * 12;
      const y = py - h;
      const r = rand(x, z);
      const top = river
        ? "#90b8a5"
        : r > 0.68
          ? "#a8bc78"
          : r > 0.3
            ? "#8ca86b"
            : "#7b9a62";
      blocks.push(
        <g key={`${x}-${z}`}>
          <path d={`M${px},${y}l23,10 -23,10 -23,-10Z`} fill={top} />
          <path
            d={`M${px - 23},${y + 10}l23,10v${h + 20}l-23,-10Z`}
            fill={river ? "#719b8c" : "#536c47"}
          />
          <path
            d={`M${px},${y + 20}l23,-10v${h + 20}l-23,10Z`}
            fill={river ? "#7ba693" : "#6b8050"}
          />
          {!river && r > 0.88 && (
            <path
              d={`M${px - 15},${y + 8}l9,4 -4,2 -9,-4Z`}
              fill="#c4cd8a"
              opacity=".65"
            />
          )}
        </g>,
      );
      if (!river && r > 0.84 && z < 15 && x > 2) {
        const height = 42 + rand(z, x) * 40;
        trees.push(
          <g key={`t${x}-${z}`}>
            <path d={`M${px - 3},${y - 2}v-20l7,-2v22Z`} fill="#5c6241" />
            {[0, 1, 2].map((n) => (
              <g key={n}>
                <path
                  d={`M${px},${y - height - n * 12}l${20 - n * 4},${height * 0.6} -${20 - n * 4},10 -${20 - n * 4},-10Z`}
                  fill={n % 2 ? "#456d4b" : "#365e42"}
                />
                <path
                  d={`M${px},${y - height - n * 12}v${height * 0.6 + 10}l-${20 - n * 4},-10Z`}
                  fill="#2b4d39"
                />
              </g>
            ))}
          </g>,
        );
      }
    }
  return (
    <svg
      className="landscape"
      viewBox="0 0 1100 520"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sky" x2="0" y2="1">
          <stop stopColor="#9eb1a1" />
          <stop offset="1" stopColor="#d2d3ae" />
        </linearGradient>
        <radialGradient id="sun">
          <stop stopColor="#fbebbb" />
          <stop offset="1" stopColor="#ecdfaa" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="veil">
          <stop stopColor="#17261f" />
          <stop offset=".45" stopColor="#1b2c21" stopOpacity=".72" />
          <stop offset="1" stopColor="#223c29" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path fill="url(#sky)" d="M0 0h1100v520H0Z" />
      <circle cx="830" cy="96" r="138" fill="url(#sun)" />
      <path
        d="M0 216h80v-40h80v-37h80v35h80v-62h60v-30h70v32h42v-60h70v-32h52v60h50v49h42v-30h80v35h60v-50h70v30h70v-50h60v150H0Z"
        fill="#81977f"
        opacity=".4"
      />
      <path
        d="M0 300v-60h180v-60h70v-30h80v40h75v-60h65v40h52v50h60v-30h60v-28h60v42h85v-25h60v-56h60v22h45v50h66v125Z"
        fill="#6e896c"
        opacity=".5"
      />
      <g opacity=".45" fill="#eef0ce">
        <path d="M730 61h66v8h30v9h-128v-8h32Z" />
        <path d="M920 123h74v7h29v10H899v-10h21Z" />
      </g>
      <g>
        {blocks}
        {trees}
      </g>
      <path fill="url(#veil)" d="M0 0h1100v520H0Z" />
      <path d="M0 490h1100v30H0Z" fill="#14251c" opacity=".12" />
    </svg>
  );
}
