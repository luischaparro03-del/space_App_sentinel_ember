"""Generate annual historical maps from the unmodified project Mapas.py source."""
from pathlib import Path
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("year", type=int, choices=(2025, 2026))
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
source_path = root / "Mapas.py"
source = source_path.read_text(encoding="utf-8")

end = "date(2025, 12, 31)" if args.year == 2025 else "date(2026, 7, 31)"
prefix = f"historico_{args.year}"

# The original Mapas.py remains intact. These substitutions only parameterize
# its date and output names for an annual historical snapshot.
source = source.replace("FECHA_INI_HIST = date(2025, 1, 1)", f"FECHA_INI_HIST = date({args.year}, 1, 1)")
source = source.replace("FECHA_FIN_HIST = date(2026, 1, 31)", f"FECHA_FIN_HIST = {end}")
source = source.replace(
    'mod_nrt = extraer_firms_seguro("MODIS_NRT", hace_7d, hoy)\nvii_nrt = extraer_firms_seguro("VIIRS_SNPP_NRT", hace_7d, hoy)',
    "# Historical view: SP data only; live NRT belongs to the All map.\nmod_nrt = pd.DataFrame()\nvii_nrt = pd.DataFrame()",
)
source = source.replace("colombia_fuegos_armonizados.parquet", f"{prefix}_armonizados.parquet")
source = source.replace("colombia_fuegos_crudos.parquet", f"{prefix}_crudos.parquet")
source = source.replace("mapa_interactivo_colombia.html", f"mapa_{prefix}.html")
source = source.replace("    fig.show()", "    # HTML is consumed by the web application; do not open a desktop browser.")

exec(compile(source, str(source_path), "exec"), {"__name__": "__main__", "__file__": str(source_path)})
