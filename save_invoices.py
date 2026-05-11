
import requests
import json
import os
from datetime import datetime

API_URL = os.environ.get(
    'SHREEBALAJI_API_URL',
    'https://hhtwjimbtppatyxtjemz.supabase.co/functions/v1/shreebalaji-api'
)
AUTH = {
    "username": os.environ.get("SHREEBALAJI_API_USER", ""),
    "password": os.environ.get("SHREEBALAJI_API_PASSWORD", "")
}

if not AUTH["username"] or not AUTH["password"]:
    raise SystemExit(
        "Set SHREEBALAJI_API_USER and SHREEBALAJI_API_PASSWORD before running this script."
    )

def create_invoice_data(inv_no, party_name, gstin, pan, mobile, address, items_data):
    items = []
    for it in items_data:
        qty = float(it['qty'])
        if 'rate' in it and it['rate'] != "":
            rate = float(it['rate'])
            amt = qty * rate
        else:
            amt = float(it['amt'])
            rate = amt / qty
        
        items.append({
            "date": it['date'],
            "desc": "PAPER REEL",
            "lr": str(it['lr']),
            "qty": str(int(qty)),
            "unit": "KGS",
            "rate": f"{rate:.4f}",
            "amt": f"{amt:.2f}"
        })

    data = {
        "invoice": {
            "invoiceNo": inv_no,
            "date": "03/05/2026"
        },
        "billTo": {
            "name": party_name,
            "address": address,
            "gstin": gstin,
            "pan": pan,
            "mobile": mobile
        },
        "shipTo": {
            "name": party_name,
            "address": address,
            "gstin": gstin,
            "pan": pan,
            "mobile": mobile
        },
        "hsn": "9965",
        "items": items
    }
    return data

invoices = [
    {
        "inv_no": "INV/2627/008",
        "party": "SUNNY INDUSTRIES",
        "gstin": "24AKFPP8779E1ZQ",
        "pan": "AKFPP8779E",
        "mobile": "9825942524",
        "address": "27B,PLOT NO E-2, SUBHASH CHANDRA ROAD NO 8, UDHNA, Surat, Gujarat, 394210",
        "items": [
            {"date": "05/04/2026", "lr": 51, "qty": 9305, "amt": 2600},
            {"date": "16/04/2026", "lr": 148, "qty": 9704, "amt": 2600},
            {"date": "21/04/2026", "lr": 208, "qty": 7096, "amt": 2400},
            {"date": "27/04/2026", "lr": 265, "qty": 6806, "amt": 2400}
        ]
    },
    {
        "inv_no": "INV/2627/009",
        "party": "SURAT PACKAGING",
        "gstin": "24AFKFS1873E1ZX",
        "pan": "AFKFS1873E",
        "mobile": "9825942524",
        "address": "Plot No D-33/11, SUSML, Road No 18, Surat, Surat, Gujarat 394230",
        "items": [
            {"date": "20/04/2026", "lr": 194, "qty": 11260, "rate": 0.14},
            {"date": "25/04/2026", "lr": 250, "qty": 11564, "rate": 0.14}
        ]
    },
    {
        "inv_no": "INV/2627/010",
        "party": "VASUDEV ENTERPRISE",
        "gstin": "24ARHPD3857E1Z1",
        "pan": "ARHPD3857E",
        "mobile": "9913301492",
        "address": "PLOT NO. 4304/8, GIDC, ROAD NO. 43B, SACHIN, Surat, Gujarat, 394230",
        "items": [
            {"date": "20/04/2026", "lr": 199, "qty": 7565, "rate": 0.18},
            {"date": "28/04/2026", "lr": 274, "qty": 11596, "rate": 0.18}
        ]
    },
    {
        "inv_no": "INV/2627/011",
        "party": "VASUDEV PAPER TUBE",
        "gstin": "24AAOHA6646Q1ZN",
        "pan": "AAOHA6646Q",
        "mobile": "9925708013",
        "address": "PLOT NO. 4304/8, GIDC, ROAD NO. 43/B, SACHIN, Surat, Gujarat, 394230",
        "items": [
            {"date": "03/04/2026", "lr": 28, "qty": 11306, "rate": 0.18},
            {"date": "07/04/2026", "lr": 69, "qty": 11579, "rate": 0.18},
            {"date": "17/04/2026", "lr": 158, "qty": 11472, "rate": 0.18}
        ]
    },
    {
        "inv_no": "INV/2627/012",
        "party": "KRISHNA ENTERPRISE",
        "gstin": "24AZEPD7783N1ZW",
        "pan": "AZEPD7783N",
        "mobile": "8238313900",
        "address": "PLOT NO. 4308/5, GIDC, ROAD NO. 43B, SACHIN, Surat, Gujarat, 394230",
        "items": [
            {"date": "24/04/2026", "lr": 234, "qty": 11261, "rate": 0.18}
        ]
    },
    {
        "inv_no": "INV/2627/013",
        "party": "GTX INDUSTRIES PRIVATE LIMITED",
        "gstin": "24AAJCG4008N1ZI",
        "pan": "AAJCG4008N",
        "mobile": "8238313900",
        "address": "Plot No 4308 PART 5, Sardar Vallabhbhai Patel Zone, Mainroad No. 08 Sub Road no 43B, Surat, Surat, Gujarat",
        "items": [
            {"date": "13/04/2026", "lr": 124, "qty": 10906, "rate": 0.18},
            {"date": "20/04/2026", "lr": 198, "qty": 3758, "rate": 0.18}
        ]
    },
    {
        "inv_no": "INV/2627/014",
        "party": "SHRINATHJI PAPERTUBE",
        "gstin": "24AEWFS7100R1Z8",
        "pan": "AEWFS7100R",
        "mobile": "9879414240",
        "address": "PLOT NO. 11 OLD PLOT NO. 7 8, BLOCK NO. 205, SAHELI GALI, Mandvi Surat, Surat, Gujarat",
        "items": [
            {"date": "11/04/2026", "lr": 106, "qty": 13025, "rate": 0.45},
            {"date": "20/04/2026", "lr": 195, "qty": 13026, "rate": 0.45}
        ]
    }
]

for inv in invoices:
    payload = {
        "action": "saveInvoice",
        **AUTH,
        "data": create_invoice_data(
            inv['inv_no'], inv['party'], inv['gstin'], inv['pan'], 
            inv['mobile'], inv['address'], inv['items']
        )
    }
    print(f"Saving {inv['inv_no']}...")
    resp = requests.post(API_URL, json=payload)
    if resp.status_code == 200:
        print(f"Success for {inv['inv_no']}: {resp.text}")
    else:
        print(f"Error saving {inv['inv_no']}: {resp.status_code} {resp.text}")
