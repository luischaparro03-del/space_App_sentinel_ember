"""Render existing annual Parquet data with the map section of the exact Mapas.py."""
from pathlib import Path
import argparse
import pandas as pd

parser = argparse.ArgumentParser()
parser.add_argument("year", type=int, choices=(2025, 2026))
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
source_path = root / "Mapas.py"
source = source_path.read_text(encoding="utf-8")
marker = "# --- 6. MAPA INTERACTIVO DEL PUNTO PONDERADO (PLOTLY 6.0+) ---"
render_source = source[source.index(marker):]

prefix = f"historico_{args.year}"
render_source = render_source.replace("colombia_fuegos_armonizados.parquet", f"{prefix}_armonizados.parquet")
render_source = render_source.replace("colombia_fuegos_crudos.parquet", f"{prefix}_crudos.parquet")
render_source = render_source.replace("mapa_interactivo_colombia.html", f"mapa_{prefix}.html")
render_source = render_source.replace("    fig.show()", "    # Written for the web application; no desktop browser is opened.")

namespace = {"__name__": "__main__", "__file__": str(source_path), "BASE": "./sentinel_data", "os": __import__("os"), "pd": pd}
exec(compile(render_source, str(source_path), "exec"), namespace)
