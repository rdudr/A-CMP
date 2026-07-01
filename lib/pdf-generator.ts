import { jsPDF } from "jspdf";
import "jspdf-autotable";

export function generateCompressorPDF(profile: any, compressors: any[], reporterName: string): ArrayBuffer {
  const doc = new jsPDF() as any;

  // Cover & Header Branding
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(3, 105, 161); // sky-700 / cyan equivalent
  doc.text("A-CMP - Compressor Audit Report", 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "normal");
  doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, 14, 26);
  doc.text(`Field Engineer: ${reporterName || "N/A"}`, 14, 31);

  // Divider
  doc.setDrawColor(226, 232, 240);
  doc.line(14, 35, 196, 35);

  // Company Profile Section
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.text("Company & Plant Profile", 14, 43);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Company Name: ${profile.companyName || "N/A"}`, 14, 50);
  doc.text(`Plant Area / Zone: ${profile.area || "N/A"}`, 14, 55);
  doc.text(`District: ${profile.district || "N/A"}`, 14, 60);
  doc.text(`State: ${profile.state || "N/A"}`, 110, 50);
  doc.text(`Pincode: ${profile.pincode || "N/A"}`, 110, 55);
  doc.text(`Overall Consumption: ${profile.overallConsumption || "N/A"} kWh/Month`, 110, 60);

  // Divider
  doc.line(14, 66, 196, 66);

  // Compressors Summary Section
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Compressor Design & Rated Specifications", 14, 74);

  const tableHeaders = [
    "Tag",
    "Type",
    "Rated kW",
    "Rated RPM",
    "Design Capacity",
    "Design SEC (kW/CFM)",
    "Design Air Gen (CFM/kW)"
  ];

  const tableRows = compressors.map((c) => {
    // Equivalent Design Capacity string
    const capacityVal = c.ratedCapacity || 0;
    const capacityUnit = c.ratedCapacityUnit || "m3/min";
    const capacityStr = `${capacityVal} ${capacityUnit}`;

    return [
      c.machineTag || "N/A",
      c.compressorType || "N/A",
      `${c.ratedKw || 0} kW`,
      c.ratedRpm ? `${c.ratedRpm} RPM` : "N/A",
      capacityStr,
      c.designedSec !== undefined && c.designedSec !== null ? Number(c.designedSec).toFixed(3) : "N/A",
      c.designedAirGen !== undefined && c.designedAirGen !== null ? Number(c.designedAirGen).toFixed(2) : "N/A"
    ];
  });

  doc.autoTable({
    startY: 80,
    head: [tableHeaders],
    body: tableRows,
    theme: "striped",
    headStyles: { fillColor: [3, 105, 161] },
    styles: { fontSize: 8 },
    margin: { top: 80 }
  });

  let currentY = doc.lastAutoTable.finalY + 15;

  // Loop through each compressor and write down the FAD Anemometer / Pump-up measurements
  compressors.forEach((c, idx) => {
    // Check page overflow
    if (currentY > 230) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(3, 105, 161);
    doc.text(`${idx + 1}. Performance Audit: ${c.machineTag} (${c.makeModel || "Unknown make/model"})`, 14, currentY);
    currentY += 6;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(`Sr No: ${c.serialNo || "N/A"} | Type: ${c.compressorType || "N/A"} | YOM: ${c.yearOfManufacture || "N/A"}`, 14, currentY);
    currentY += 4.5;
    doc.text(`Rated Power: ${c.ratedKw || 0} kW (${c.ratedHp || 0} HP) | Speed: ${c.ratedRpm ? `${c.ratedRpm} RPM` : "N/A"} | Starter: ${c.starterType || "N/A"}`, 14, currentY);
    currentY += 4.5;
    doc.text(`Rated Flow: ${c.ratedCapacity || 0} ${c.ratedCapacityUnit || "m3/min"} | Rated Press: ${c.ratedPressure || 0} bar | Process Press: ${c.processPressure || 0} bar`, 14, currentY);
    currentY += 4.5;
    doc.text(`Rated FLA: ${c.ratedCurrent ? `${c.ratedCurrent} A` : "N/A"} | Motor Efficiency: ${c.motorEfficiency ? `${c.motorEfficiency}%` : "N/A"} | Calculated Load Factor: ${c.loadFactor !== undefined && c.loadFactor !== null ? `${Number(c.loadFactor).toFixed(2)}%` : "N/A"}`, 14, currentY);
    currentY += 4.5;
    doc.text(`Operating Days: ${c.annualOperatingDays || "N/A"} days/year | Electricity Cost: ${c.powerCost ? `Rs. ${c.powerCost}/hour` : "N/A"}`, 14, currentY);
    currentY += 8;

    // FAD Anemometer Test Section
    if (c.fadActive) {
      if (currentY > 240) {
        doc.addPage();
        currentY = 20;
      }
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("- Free Air Delivery (FAD) Anemometer Test Results", 14, currentY);
      currentY += 6;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Duct Area Type: ${c.fadAreaType} | Calculated Suction Area: ${c.fadSuctionArea?.toFixed(4)} Sqm`, 18, currentY);
      currentY += 5;
      
      // Parse velocity grid points
      let velocityPointsStr = "N/A";
      if (c.fadVelocities) {
        try {
          const arr = JSON.parse(c.fadVelocities);
          if (Array.isArray(arr)) {
            velocityPointsStr = arr.map((v, i) => `Pt${i+1}: ${v}m/s`).join(", ");
          }
        } catch {}
      }
      
      const splitVelocities = doc.splitTextToSize(`Measured Velocity Points: ${velocityPointsStr}`, 175);
      doc.text(splitVelocities, 18, currentY);
      currentY += (splitVelocities.length * 4.5) + 1;

      doc.text(`Average Velocity: ${c.fadAvgVelocity?.toFixed(2)} m/s | Running Pressure: ${c.fadRunningPressure} bar | Measured Power: ${c.fadMeasuredPower} kW`, 18, currentY);
      currentY += 6;

      // Draw comparison table for FAD
      const fadHeaders = ["Metric", "Design (Rated)", "Actual (Anemometer FAD)", "Deviation", "Status"];
      
      // Rated values in CFM
      const designCfm = c.designedAirGen && c.ratedKw ? (c.designedAirGen * c.ratedKw) : 0;
      const designSec = c.designedSec || 0;
      const designAirGen = c.designedAirGen || 0;

      const actCfm = c.fadAirDeliveryCfm || 0;
      const actSec = c.fadActualSec || 0;
      const actAirGen = c.fadActualAirGen || 0;

      const cfmDev = designCfm > 0 ? ((actCfm - designCfm) / designCfm) * 100 : 0;
      const secDev = designSec > 0 ? ((actSec - designSec) / designSec) * 100 : 0;
      const genDev = designAirGen > 0 ? ((actAirGen - designAirGen) / designAirGen) * 100 : 0;

      const fadRows = [
        [
          "Flow Capacity (CFM)", 
          designCfm > 0 ? designCfm.toFixed(1) : "N/A", 
          actCfm.toFixed(1), 
          `${cfmDev.toFixed(1)}%`,
          actCfm < designCfm ? "ALERT (Low Flow)" : "Normal"
        ],
        [
          "Specific Energy (kW/CFM)", 
          designSec > 0 ? designSec.toFixed(3) : "N/A", 
          actSec.toFixed(3), 
          `${secDev.toFixed(1)}%`,
          actSec > designSec ? "ALERT (High SEC)" : "Normal"
        ],
        [
          "Air Generation (CFM/kW)", 
          designAirGen > 0 ? designAirGen.toFixed(2) : "N/A", 
          actAirGen.toFixed(2), 
          `${genDev.toFixed(1)}%`,
          actAirGen < designAirGen ? "ALERT (Low Efficiency)" : "Normal"
        ]
      ];

      doc.autoTable({
        startY: currentY,
        head: [fadHeaders],
        body: fadRows,
        theme: "plain",
        headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42] },
        styles: { fontSize: 8 },
        margin: { left: 18, right: 14 }
      });

      currentY = doc.lastAutoTable.finalY + 4;
      
      if (c.fadDescription) {
        doc.text(`FAD Remarks: ${c.fadDescription}`, 18, currentY);
        currentY += 6;
      }
    }

    // Pump Up Test Section
    if (c.pumpActive) {
      if (currentY > 240) {
        doc.addPage();
        currentY = 20;
      }
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("- Receiver Tank Pump-Up Test Results", 14, currentY);
      currentY += 6;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Volume: ${c.pumpTankVolume} ${c.pumpTankVolumeUnit} | P1 starting: ${c.pumpP1} bar | P2 ending: ${c.pumpP2} bar | Timings: ${c.pumpTimeSec} seconds`, 18, currentY);
      currentY += 5;

      const designM3Min = c.ratedCapacityUnit === "m3/min" ? (c.ratedCapacity || 0) : ((c.ratedCapacity || 0) / 35.3147);
      const actM3Min = c.pumpActualFadM3Min || 0;
      const pumpDev = designM3Min > 0 ? ((actM3Min - designM3Min) / designM3Min) * 100 : 0;

      const pumpHeaders = ["Metric", "Design (Rated)", "Actual (Pump-Up)", "Deviation", "Status"];
      const pumpRows = [
        [
          "Flow (m³/min)", 
          designM3Min > 0 ? designM3Min.toFixed(2) : "N/A", 
          actM3Min.toFixed(2), 
          `${pumpDev.toFixed(1)}%`,
          actM3Min < designM3Min ? "ALERT (Low Flow)" : "Normal"
        ]
      ];

      doc.autoTable({
        startY: currentY,
        head: [pumpHeaders],
        body: pumpRows,
        theme: "plain",
        headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42] },
        styles: { fontSize: 8 },
        margin: { left: 18, right: 14 }
      });

      currentY = doc.lastAutoTable.finalY + 4;
      
      if (c.pumpDescription) {
        doc.text(`Pump Up Remarks: ${c.pumpDescription}`, 18, currentY);
        currentY += 6;
      }
    }

    if (c.description) {
      if (currentY > 270) {
        doc.addPage();
        currentY = 20;
      }
      doc.setFontSize(9);
      doc.text(`General Remarks: ${c.description}`, 14, currentY);
      currentY += 6;
    }

    currentY += 5; // spacing between compressors
  });

  // Footer Branding
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text("A-CMP — Industrial Air Compressor Auditing Platform | IITGN Kisem Laboratory", 14, 287);
    doc.text(`Page ${i} of ${totalPages}`, 180, 287);
  }

  return doc.output("arraybuffer");
}
