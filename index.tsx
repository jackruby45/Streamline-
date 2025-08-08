
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// --- Unit Conversion Constants & Helpers ---
const CONVERSIONS = {
    ftToM: (ft: number) => ft * 0.3048,
    mToFt: (m: number) => m / 0.3048,
    inToM: (inch: number) => inch * 0.0254,
    mToIn: (m: number) => m / 0.0254,
    FtoC: (f: number) => (f - 32) * 5 / 9,
    CtoF: (c: number) => c * 9 / 5 + 32,
    btuHrFtFtoWMK: (k: number) => k * 1.73073,
    wmkToBtuHrFtF: (k: number) => k / 1.73073,
};

const UNIT_SYSTEMS = {
    imperial: {
        temp: '°F', lengthLarge: 'ft', lengthSmall: 'in',
        conductivity: 'BTU/hr-ft-°F',
        defaults: { temp: 63, isoTemp: 73, length: 5, x: 0, z: 4, ins: 0, bed: 0, od: 8.625, thick: 0.322 },
    },
};

const MATERIAL_STORAGE_KEY = 'pipelineMaterialLibrary';

// --- Interfaces and Types ---
type PipeOrientation = 'parallel' | 'perpendicular';
type UnitSystem = 'imperial' | 'metric';
type MaterialType = 'soil' | 'pipe' | 'insulation' | 'bedding';

interface CustomMaterial {
    id: string;
    type: MaterialType;
    name: string;
    k: number; // Stored in W/m-K
}

interface Pipe { // All values are in SI (meters, Celsius) for calculation
    id: number;
    name: string;
    role: 'heat_source' | 'affected_pipe';
    orientation: PipeOrientation;
    x: number; // (m) Used for parallel pipes
    y: number; // (m) Used for perpendicular pipes
    z: number; // (m)
    temp?: number; // (°C)
    od: number; // (m)
    thickness: number; // (m)
    k_pipe: number; // (W/m-K)
    ins_thickness: number; // (m)
    k_ins: number; // (W/m-K)
    bed_thickness: number; // (m)
    k_bedding: number; // (W/m-K)
    element: HTMLElement;
}

type CalculationSoilLayer = {
    k: number;
    thickness: number;
    depth_top: number;
    depth_bottom: number;
};

interface SoilLayer extends CalculationSoilLayer { // All values are in SI (meters, W/m-K)
    element: HTMLElement;
}

interface SourceCalculation {
    pipeId: number;
    pipeName: string;
    R_pipe: number; // (K-m)/W
    R_ins: number; // (K-m)/W
    R_bed: number;
    R_soil: number;
    R_total: number;
    Q: number; // W/m
}

interface InteractionCalculation {
    sourcePipeName: string;
    k_eff_path: number; // W/m-K
    d_real: number; // m
    d_image: number; // m
    tempRise: number; // °C
}

interface AffectedPipeCalculation {
    pipeId: number;
    pipeName: string;
    interactions: InteractionCalculation[];
    totalTempRise: number; // °C
    finalTemp: number; // °C
}

interface DetailedCalculations {
    sources: SourceCalculation[];
    affectedPipes: AffectedPipeCalculation[];
}


interface CalculationData {
    inputs: {
        pipes: Pipe[];
        soilLayers: SoilLayer[];
        T_soil: number; // °C
    };
    results: {
        pipeId: number;
        pipeName: string;
        finalTemp: number; // °C
    }[];
    sceneData: SceneData;
    latex: string;
    detailedCalculations: DetailedCalculations;
}

interface ProjectInfo {
    name: string;
    location: string;
    system: string;
    engineer: string;
    date: string;
    revision: string;
    description: string;
}

interface SceneData {
    worldOrigin: { x: number; y: number }; // canvas pixels
    worldWidth: number; // meters
    worldHeight: number; // meters
    worldDepth: number; // meters
    worldMinX: number; // meters
    worldMinY: number; // meters
    scale: number; // pixels/meter
    groundY: number; // canvas pixels
    T_soil: number; // °C
    maxTemp: number; // °C
    minTemp: number; // °C
    pipes: {
        id: number;
        x: number; // m
        y: number; // m
        z: number; // m
        orientation: PipeOrientation;
        r_pipe: number; // m
        r_ins: number; // m
        r_bed: number; // m
        temp: number; // °C
        isSource: boolean;
        name: string;
        Q?: number; // W/m
    }[];
    layers: CalculationSoilLayer[];
}

interface Isotherm {
    id: number;
    temp: number; // In current display units
    color: string;
    enabled: boolean;
}
interface IsoSurface {
    id: number;
    temp: number; // In current display units
    color: string;
    opacity: number;
    enabled: boolean;
}


type ViewMode = '2d' | '3d';


// --- Constants ---
// Values are stored as [OD (in), thickness (in)]
const PIPE_PRESETS_IMPERIAL: { [key: string]: { od: number, thickness: number } } = {
    '1_sch40': { od: 1.315, thickness: 0.133 }, '2_sch40': { od: 2.375, thickness: 0.154 },
    '3_sch40': { od: 3.5, thickness: 0.216 }, '4_sch40': { od: 4.5, thickness: 0.237 },
    '6_sch40': { od: 6.625, thickness: 0.280 }, '8_sch40': { od: 8.625, thickness: 0.322 },
    '10_sch40': { od: 10.75, thickness: 0.365 }, '12_sch40': { od: 12.75, thickness: 0.406 },
};
const LEGEND_WIDTH = 80;

// Base thermal conductivities in W/m-K
const MATERIAL_PRESETS = {
    soil: [
        { name: 'Saturated Soil', k: 2.5 }, { name: 'Wet Soil', k: 2.0 }, { name: 'Moist Soil', k: 1.5 },
        { name: 'Loam', k: 1.0 }, { name: 'Asphalt', k: 0.75 }, { name: 'Dry Soil', k: 0.5 },
        { name: 'Dry Gravel', k: 0.35 }, { name: 'Dry Sand', k: 0.27 }
    ],
    pipe: [
        { name: 'Carbon Steel', k: 54 }, { name: 'Stainless Steel', k: 16 }, { name: 'HDPE', k: 0.45 }
    ],
    insulation: [
        { name: 'No Insulation', k: 0 }, { name: 'Calcium Silicate', k: 0.05 },
        { name: 'Fiberglass', k: 0.04 }, { name: 'Polyurethane Foam', k: 0.025 }
    ],
    bedding: [
        { name: 'None', k: 0 }, { name: 'Gravel', k: 0.35 }, { name: 'Sand', k: 0.27 }
    ]
};

// --- DOM Element Selectors ---
const tabLinks = document.querySelectorAll('.tab-link');
const tabContents = document.querySelectorAll('.tab-content');
const projectNameInput = document.getElementById('project-name') as HTMLTextAreaElement;
const projectLocationInput = document.getElementById('project-location') as HTMLTextAreaElement;
const systemNumberInput = document.getElementById('system-number') as HTMLTextAreaElement;
const engineerNameInput = document.getElementById('engineer-name') as HTMLTextAreaElement;
const evalDateInput = document.getElementById('eval-date') as HTMLInputElement;
const revisionNumberInput = document.getElementById('revision-number') as HTMLInputElement;
const projectDescriptionInput = document.getElementById('project-description') as HTMLTextAreaElement;
const soilTempInput = document.getElementById('soil-temp') as HTMLInputElement;
const soilLayersList = document.getElementById('soil-layers-list') as HTMLDivElement;
const addSoilLayerBtn = document.getElementById('add-soil-layer-btn') as HTMLButtonElement;
const pipeList = document.getElementById('pipe-list') as HTMLDivElement;
const addPipeBtn = document.getElementById('add-pipe-btn') as HTMLButtonElement;
const calculateBtn = document.getElementById('calculate-btn') as HTMLButtonElement;
const exampleBtn = document.getElementById('example-btn') as HTMLButtonElement;
const outputWrapper = document.getElementById('output-wrapper') as HTMLDivElement;
const resultsTableContainer = document.getElementById('results-table-container') as HTMLDivElement;
const errorContainer = document.getElementById('results-error-container') as HTMLDivElement;
const canvas = document.getElementById('heat-transfer-canvas') as HTMLCanvasElement;
const webglCanvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const tooltipElement = document.getElementById('tooltip') as HTMLDivElement;
const saveScenarioBtn = document.getElementById('save-scenario-btn') as HTMLButtonElement;
const loadScenarioBtn = document.getElementById('load-scenario-btn') as HTMLButtonElement;
const loadScenarioInput = document.getElementById('load-scenario-input') as HTMLInputElement;
const copyLatexBtn = document.getElementById('copy-latex-btn') as HTMLButtonElement;
const copyBtnText = document.getElementById('copy-btn-text') as HTMLSpanElement;
const templates = document.getElementById('templates') as HTMLDivElement;
const soilLayerTemplate = templates.querySelector('.soil-layer-row') as HTMLElement;
const pipeTemplate = templates.querySelector('.pipe-row') as HTMLElement;
const isothermTemplate = templates.querySelector('.isotherm-row') as HTMLElement;
const isosurfaceTemplate = templates.querySelector('.isosurface-row') as HTMLElement;
const visualizationOptions = document.getElementById('visualization-options') as HTMLDivElement;
const viewModeRadios = document.querySelectorAll('input[name="view-mode"]');
const isothermList = document.getElementById('isotherm-list') as HTMLDivElement;
const addIsothermBtn = document.getElementById('add-isotherm-btn') as HTMLButtonElement;
const isosurfaceList = document.getElementById('isosurface-list') as HTMLDivElement;
const addIsosurfaceBtn = document.getElementById('add-isosurface-btn') as HTMLButtonElement;
const toggleFluxVectors = document.getElementById('toggle-flux-vectors') as HTMLInputElement;
const visToggles = document.getElementById('vis-toggles') as HTMLDivElement;
const isothermControls = document.getElementById('isotherm-controls') as HTMLDivElement;
const isosurfaceControls = document.getElementById('isosurface-controls') as HTMLDivElement;


// --- State ---
let animationFrameId: number | null = null;
let currentCalculationData: CalculationData | null = null;
let pipeIdCounter = 0;
let isothermIdCounter = 0;
let isoSurfaceIdCounter = 0;
let currentViewMode: ViewMode = '2d';
let threeDManager: ThreeDManager | null = null;
let customMaterials: CustomMaterial[] = [];
let isotherms: Isotherm[] = [];
let isoSurfaces: IsoSurface[] = [];
let showFluxVectors = false;
let draggedPipeId: number | null = null;
let dragOffset = { x: 0, y: 0 }; // In canvas pixels
const currentUnitSystem: UnitSystem = 'imperial';

// --- UI Management ---
function updateUnitsUI() {
    const system = UNIT_SYSTEMS.imperial;

    // Update placeholders and values
    soilTempInput.value = system.defaults.temp.toString();
    isothermList.querySelectorAll('.isotherm-temp-input').forEach(el => {
        (el as HTMLInputElement).value = system.defaults.isoTemp.toString();
    });
     isosurfaceList.querySelectorAll('.isosurface-temp-input').forEach(el => {
        (el as HTMLInputElement).value = system.defaults.isoTemp.toString();
    });
    
    populateAllMaterialSelects();
    renderMaterialLibrary(); // Re-render to show correct k-values

    // Invalidate results if they were already showing
    if (outputWrapper.style.display !== 'none') {
        handleCalculate();
    }
}

function setupTabs() {
    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            const tabId = link.getAttribute('data-tab');
            tabLinks.forEach(innerLink => innerLink.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            link.classList.add('active');
            document.getElementById(tabId!)?.classList.add('active');
        });
    });
}

function addSoilLayer(data?: {k: number, thickness: number}) {
    const newLayer = soilLayerTemplate.cloneNode(true) as HTMLElement;
    const materialSelect = newLayer.querySelector('.soil-layer-material-select') as HTMLSelectElement;
    populateMaterialSelect(materialSelect, 'soil');

    if (data) {
        materialSelect.value = data.k.toString();
        const thicknessInput = newLayer.querySelector('.soil-layer-thickness') as HTMLInputElement;
        const thicknessInDisplayUnit = CONVERSIONS.mToFt(data.thickness);
        thicknessInput.value = thicknessInDisplayUnit.toFixed(2);
    }

    newLayer.querySelector('.remove-btn')?.addEventListener('click', () => newLayer.remove());
    soilLayersList.appendChild(newLayer);
    return newLayer;
}

function addPipe(data?: Partial<Pipe>) {
    const newPipe = pipeTemplate.cloneNode(true) as HTMLElement;
    newPipe.dataset.id = (++pipeIdCounter).toString();
    const pipeNameInput = newPipe.querySelector('.pipe-name') as HTMLInputElement;
    pipeNameInput.value = data?.name || `Pipe ${pipeIdCounter}`;

    // Populate selects
    populateMaterialSelect(newPipe.querySelector('.pipe-material-select')! as HTMLSelectElement, 'pipe');
    populateMaterialSelect(newPipe.querySelector('.pipe-insulation-material-select')! as HTMLSelectElement, 'insulation');
    populateMaterialSelect(newPipe.querySelector('.pipe-bedding-material-select')! as HTMLSelectElement, 'bedding');
    const presetSelect = newPipe.querySelector('.pipe-preset') as HTMLSelectElement;
    populatePresetDropdown(presetSelect);

    // Set values from data if provided
    if(data) {
        (newPipe.querySelector('.pipe-role') as HTMLSelectElement).value = data.role || 'affected_pipe';
        (newPipe.querySelector('.pipe-orientation') as HTMLSelectElement).value = data.orientation || 'parallel';
        
        const x_val = CONVERSIONS.mToFt(data.x || 0);
        const y_val = CONVERSIONS.mToFt(data.y || 0);
        const z_val = CONVERSIONS.mToFt(data.z || 0);
        (newPipe.querySelector('.pipe-x') as HTMLInputElement).value = x_val.toFixed(2);
        (newPipe.querySelector('.pipe-y') as HTMLInputElement).value = y_val.toFixed(2);
        (newPipe.querySelector('.pipe-z') as HTMLInputElement).value = z_val.toFixed(2);
        
        if(data.temp !== undefined) {
             const temp_val = CONVERSIONS.CtoF(data.temp);
            (newPipe.querySelector('.pipe-temp') as HTMLInputElement).value = temp_val.toFixed(1);
        }

        (newPipe.querySelector('.pipe-od') as HTMLInputElement).value = CONVERSIONS.mToIn(data.od!).toFixed(3);
        (newPipe.querySelector('.pipe-thickness') as HTMLInputElement).value = CONVERSIONS.mToIn(data.thickness!).toFixed(3);
        (newPipe.querySelector('.pipe-insulation-thickness') as HTMLInputElement).value = CONVERSIONS.mToIn(data.ins_thickness!).toFixed(2);
        (newPipe.querySelector('.pipe-bedding-thickness') as HTMLInputElement).value = CONVERSIONS.mToIn(data.bed_thickness!).toFixed(2);

        (newPipe.querySelector('.pipe-material-select') as HTMLSelectElement).value = data.k_pipe?.toString() || '';
        (newPipe.querySelector('.pipe-insulation-material-select') as HTMLSelectElement).value = data.k_ins?.toString() || '0';
        (newPipe.querySelector('.pipe-bedding-material-select') as HTMLSelectElement).value = data.k_bedding?.toString() || '0';
    }


    const roleSelect = newPipe.querySelector('.pipe-role') as HTMLSelectElement;
    const tempInput = newPipe.querySelector('.pipe-temp') as HTMLInputElement;
    roleSelect.addEventListener('change', () => tempInput.disabled = roleSelect.value !== 'heat_source');
    tempInput.disabled = roleSelect.value !== 'heat_source';

    const orientationSelect = newPipe.querySelector('.pipe-orientation') as HTMLSelectElement;
    const xCoordGroup = newPipe.querySelector('.x-coord-group') as HTMLElement;
    const yCoordGroup = newPipe.querySelector('.y-coord-group') as HTMLElement;
    const updateOrientationView = () => {
        const isParallel = orientationSelect.value === 'parallel';
        xCoordGroup.classList.toggle('hidden', !isParallel);
        yCoordGroup.classList.toggle('hidden', isParallel);
    };
    orientationSelect.addEventListener('change', updateOrientationView);
    updateOrientationView();

    
    const odInput = newPipe.querySelector('.pipe-od') as HTMLInputElement;
    const thicknessInput = newPipe.querySelector('.pipe-thickness') as HTMLInputElement;
    presetSelect.addEventListener('change', () => {
        handlePresetChange(presetSelect, odInput, thicknessInput);
        validatePipeRow(newPipe);
    });

    const inputsToValidate = ['.pipe-z', '.pipe-od', '.pipe-thickness', '.pipe-insulation-thickness', '.pipe-bedding-thickness'];
    inputsToValidate.forEach(selector => {
        const input = newPipe.querySelector(selector) as HTMLInputElement;
        input.addEventListener('input', () => validatePipeRow(newPipe));
    });


    newPipe.querySelector('.remove-btn')?.addEventListener('click', () => newPipe.remove());
    pipeList.appendChild(newPipe);
    return newPipe;
}

function addIsotherm(data?: Partial<Isotherm>) {
    const newRow = isothermTemplate.cloneNode(true) as HTMLElement;
    const id = data?.id || ++isothermIdCounter;
    newRow.dataset.id = id.toString();

    const enabledCheckbox = newRow.querySelector('.toggle-isotherm-row') as HTMLInputElement;
    const tempInput = newRow.querySelector('.isotherm-temp-input') as HTMLInputElement;
    const colorInput = newRow.querySelector('.isotherm-color-input') as HTMLInputElement;
    const removeBtn = newRow.querySelector('.remove-isotherm-btn') as HTMLButtonElement;
    
    const systemDefaults = UNIT_SYSTEMS.imperial.defaults;
    tempInput.value = data?.temp?.toString() || systemDefaults.isoTemp.toString();
    colorInput.value = data?.color || '#FFFFFF';
    enabledCheckbox.checked = data?.enabled ?? true;
    tempInput.disabled = !enabledCheckbox.checked;

    const updateState = () => {
        const existing = isotherms.find(iso => iso.id === id);
        const newData = {
            id: id,
            temp: parseFloat(tempInput.value) || 0,
            color: colorInput.value,
            enabled: enabledCheckbox.checked
        };
        if(existing) {
            Object.assign(existing, newData);
        } else {
            isotherms.push(newData);
        }
        if (currentCalculationData) {
            draw2DScene(currentCalculationData.sceneData);
        }
    };

    enabledCheckbox.addEventListener('change', () => {
        tempInput.disabled = !enabledCheckbox.checked;
        updateState();
    });
    tempInput.addEventListener('input', updateState);
    colorInput.addEventListener('input', updateState);
    removeBtn.addEventListener('click', () => {
        isotherms = isotherms.filter(iso => iso.id !== id);
        newRow.remove();
        if (currentCalculationData) {
            draw2DScene(currentCalculationData.sceneData);
        }
    });

    isothermList.appendChild(newRow);
    isotherms.push({ id, temp: parseFloat(tempInput.value), color: colorInput.value, enabled: enabledCheckbox.checked });
}

function addIsoSurface(data?: Partial<IsoSurface>) {
    const newRow = isosurfaceTemplate.cloneNode(true) as HTMLElement;
    const id = data?.id || ++isoSurfaceIdCounter;
    newRow.dataset.id = id.toString();

    const enabledCheckbox = newRow.querySelector('.toggle-isosurface-row') as HTMLInputElement;
    const tempInput = newRow.querySelector('.isosurface-temp-input') as HTMLInputElement;
    const colorInput = newRow.querySelector('.isosurface-color-input') as HTMLInputElement;
    const opacitySlider = newRow.querySelector('.isosurface-opacity-slider') as HTMLInputElement;
    const removeBtn = newRow.querySelector('.remove-isosurface-btn') as HTMLButtonElement;

    const systemDefaults = UNIT_SYSTEMS.imperial.defaults;
    tempInput.value = data?.temp?.toString() || systemDefaults.isoTemp.toString();
    colorInput.value = data?.color || '#48BFE3';
    opacitySlider.value = data?.opacity?.toString() || '0.3';
    enabledCheckbox.checked = data?.enabled ?? true;

    const updateState = () => {
        const existing = isoSurfaces.find(iso => iso.id === id);
        const newData: IsoSurface = {
            id,
            temp: parseFloat(tempInput.value) || 0,
            color: colorInput.value,
            opacity: parseFloat(opacitySlider.value),
            enabled: enabledCheckbox.checked
        };
        if (existing) {
            Object.assign(existing, newData);
        } else {
            isoSurfaces.push(newData);
        }
        if (currentCalculationData && currentViewMode === '3d') {
            threeDManager?.buildScene(currentCalculationData.sceneData, isoSurfaces);
        }
    };
    
    enabledCheckbox.addEventListener('change', updateState);
    tempInput.addEventListener('input', updateState);
    colorInput.addEventListener('input', updateState);
    opacitySlider.addEventListener('input', updateState);

    removeBtn.addEventListener('click', () => {
        isoSurfaces = isoSurfaces.filter(iso => iso.id !== id);
        newRow.remove();
        if (currentCalculationData && currentViewMode === '3d') {
             threeDManager?.buildScene(currentCalculationData.sceneData, isoSurfaces);
        }
    });

    isosurfaceList.appendChild(newRow);
    if (!isoSurfaces.find(s => s.id === id)) {
        isoSurfaces.push({ 
            id, 
            temp: parseFloat(tempInput.value), 
            color: colorInput.value, 
            opacity: parseFloat(opacitySlider.value),
            enabled: enabledCheckbox.checked 
        });
    }
}


function populatePresetDropdown(select: HTMLSelectElement) {
    select.innerHTML = '<option value="custom">Custom...</option>';
    for (const key in PIPE_PRESETS_IMPERIAL) {
        const option = document.createElement('option');
        option.value = key;
        const nominalSize = key.split('_')[0].replace('_', '.');
        option.textContent = `${nominalSize}-inch Sch. 40`;
        select.appendChild(option);
    }
    select.value = 'custom';
}

function handlePresetChange(presetSelect: HTMLSelectElement, odInput: HTMLInputElement, thicknessInput: HTMLInputElement) {
    if (!presetSelect || !odInput || !thicknessInput) return;
    const key = presetSelect.value;
    if (key === 'custom') return;

    const preset = PIPE_PRESETS_IMPERIAL[key];
    if (preset) {
        odInput.value = preset.od.toFixed(3);
        thicknessInput.value = preset.thickness.toFixed(3);
    }
}

function validatePipeRow(pipeRow: HTMLElement): boolean {
    const errorContainer = pipeRow.querySelector('.pipe-error-container') as HTMLDivElement;
    errorContainer.textContent = ''; // Clear previous errors

    const zInput = pipeRow.querySelector('.pipe-z') as HTMLInputElement;
    const odInput = pipeRow.querySelector('.pipe-od') as HTMLInputElement;
    const insulationInput = pipeRow.querySelector('.pipe-insulation-thickness') as HTMLInputElement;
    const beddingInput = pipeRow.querySelector('.pipe-bedding-thickness') as HTMLInputElement;
    
    const z = parseFloat(zInput.value) || 0; // Depth to centerline
    const od = parseFloat(odInput.value) || 0;
    const ins = parseFloat(insulationInput.value) || 0;
    const bed = parseFloat(beddingInput.value) || 0;
    
    const z_m = CONVERSIONS.ftToM(z);
    const totalRadius_m = CONVERSIONS.inToM(od / 2 + ins + bed);
    if (z_m < totalRadius_m) {
        errorContainer.textContent = 'Pipe depth (Z) must be greater than the total radius (OD/2 + insulation + bedding).';
        return false;
    }

    return true;
}


// --- Data Gathering from UI ---
function getProjectInfo(): ProjectInfo {
    return {
        name: projectNameInput.value,
        location: projectLocationInput.value,
        system: systemNumberInput.value,
        engineer: engineerNameInput.value,
        date: evalDateInput.value,
        revision: revisionNumberInput.value,
        description: projectDescriptionInput.value,
    };
}
function getSoilLayers(): SoilLayer[] {
    const layers: SoilLayer[] = [];
    let currentDepth = 0;
    const layerElements = soilLayersList.querySelectorAll('.soil-layer-row');
    layerElements.forEach(el => {
        const thicknessInput = el.querySelector('.soil-layer-thickness') as HTMLInputElement;
        const kSelect = el.querySelector('.soil-layer-material-select') as HTMLSelectElement;

        const rawThickness = parseFloat(thicknessInput.value) || 0;
        const thickness = CONVERSIONS.ftToM(rawThickness);
        const k = parseFloat(kSelect.value) || 0;

        if (thickness > 0) {
            layers.push({
                k,
                thickness,
                depth_top: currentDepth,
                depth_bottom: currentDepth + thickness,
                element: el as HTMLElement
            });
            currentDepth += thickness;
        }
    });
    return layers;
}

function getPipes(): Pipe[] {
    const pipes: Pipe[] = [];
    pipeList.querySelectorAll('.pipe-row').forEach((el) => {
        const id = parseInt(el.getAttribute('data-id')!, 10);
        const name = (el.querySelector('.pipe-name') as HTMLInputElement).value;
        const role = (el.querySelector('.pipe-role') as HTMLSelectElement).value as 'heat_source' | 'affected_pipe';
        const orientation = (el.querySelector('.pipe-orientation') as HTMLSelectElement).value as PipeOrientation;
        
        const rawX = parseFloat((el.querySelector('.pipe-x') as HTMLInputElement).value) || 0;
        const rawY = parseFloat((el.querySelector('.pipe-y') as HTMLInputElement).value) || 0;
        const rawZ = parseFloat((el.querySelector('.pipe-z') as HTMLInputElement).value) || 0;
        
        const rawOD = parseFloat((el.querySelector('.pipe-od') as HTMLInputElement).value) || 0;
        const rawThickness = parseFloat((el.querySelector('.pipe-thickness') as HTMLInputElement).value) || 0;
        const rawInsThickness = parseFloat((el.querySelector('.pipe-insulation-thickness') as HTMLInputElement).value) || 0;
        const rawBedThickness = parseFloat((el.querySelector('.pipe-bedding-thickness') as HTMLInputElement).value) || 0;

        const kPipe = parseFloat((el.querySelector('.pipe-material-select') as HTMLSelectElement).value) || 0;
        const kIns = parseFloat((el.querySelector('.pipe-insulation-material-select') as HTMLSelectElement).value) || 0;
        const kBedding = parseFloat((el.querySelector('.pipe-bedding-material-select') as HTMLSelectElement).value) || 0;
        
        let temp: number | undefined;
        if (role === 'heat_source') {
            const rawTemp = parseFloat((el.querySelector('.pipe-temp') as HTMLInputElement).value) || 0;
            temp = CONVERSIONS.FtoC(rawTemp);
        }

        const pipe: Pipe = {
            id, name, role, orientation, temp, element: el as HTMLElement,
            x: CONVERSIONS.ftToM(rawX),
            y: CONVERSIONS.ftToM(rawY),
            z: CONVERSIONS.ftToM(rawZ),
            od: CONVERSIONS.inToM(rawOD),
            thickness: CONVERSIONS.inToM(rawThickness),
            ins_thickness: CONVERSIONS.inToM(rawInsThickness),
            bed_thickness: CONVERSIONS.inToM(rawBedThickness),
            k_pipe: kPipe,
            k_ins: kIns,
            k_bedding: kBedding,
        };
        pipes.push(pipe);
    });
    return pipes;
}

// --- Calculation Engine ---
function getEffectiveSoilKForPipe(pipe: Partial<Pipe>, soilLayers: CalculationSoilLayer[]): number {
    const r_outer = (pipe.od || 0) / 2 + (pipe.ins_thickness || 0) + (pipe.bed_thickness || 0);
    const pipeCenterZ = pipe.z || 0;
    
    // Simple average for now. Could be more complex (e.g., weighted by path length)
    let totalK = 0;
    let layersInvolved = 0;
    for(const layer of soilLayers) {
        const top = layer.depth_top;
        const bottom = layer.depth_bottom;
        // Check if the pipe (including bedding) intersects with this layer
        if (pipeCenterZ + r_outer > top && pipeCenterZ - r_outer < bottom) {
            totalK += layer.k;
            layersInvolved++;
        }
    }
    return layersInvolved > 0 ? totalK / layersInvolved : (soilLayers[0]?.k || 1.5);
}

function getEffectiveKForPath(p1: {x:number, z:number}, p2: {x:number, z:number}, soilLayers: CalculationSoilLayer[]): number {
    const x1 = p1.x, z1 = p1.z, x2 = p2.x, z2 = p2.z;
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length < 1e-6) return soilLayers[0]?.k || 1.5;

    let totalResistance = 0;
    const steps = 100; // Number of segments to check along the path
    
    for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        const z = z1 + t * (z2 - z1);
        const k = getSoilKAtPoint(0, z, soilLayers);
        if (k > 0) {
            totalResistance += (length / steps) / k;
        }
    }
    
    if (totalResistance === 0) return soilLayers[0]?.k || 1.5; // Avoid division by zero

    return length / totalResistance;
}

function calculateTemperatures(pipes: Pipe[], soilLayers: SoilLayer[], T_soil_C: number): CalculationData {
    const heatSources = pipes.filter(p => p.role === 'heat_source');
    const affectedPipes = pipes.filter(p => p.role === 'affected_pipe');

    // 1. Calculate heat flux (Q) for each heat source
    const sourceCalcs: SourceCalculation[] = heatSources.map(pipe => {
        const T_pipe = pipe.temp!;
        const r_pipe_outer = pipe.od / 2;
        const r_pipe_inner = r_pipe_outer - pipe.thickness;
        const r_ins_outer = r_pipe_outer + pipe.ins_thickness;
        const r_bed_outer = r_ins_outer + pipe.bed_thickness;

        // Pipe wall resistance is often negligible, but included for completeness
        const R_pipe = pipe.k_pipe > 0 && r_pipe_inner > 0 ? Math.log(r_pipe_outer / r_pipe_inner) / (2 * Math.PI * pipe.k_pipe) : 0;
        
        const R_ins = pipe.k_ins > 0 ? Math.log(r_ins_outer / r_pipe_outer) / (2 * Math.PI * pipe.k_ins) : 0;
        const R_bed = pipe.k_bedding > 0 ? Math.log(r_bed_outer / r_ins_outer) / (2 * Math.PI * pipe.k_bedding) : 0;

        const k_eff_soil = getEffectiveSoilKForPipe(pipe, soilLayers);
        const R_soil = k_eff_soil > 0 ? Math.log((2 * pipe.z) / r_bed_outer) / (2 * Math.PI * k_eff_soil) : 0;

        const R_total = R_pipe + R_ins + R_bed + R_soil;
        const Q = (R_total > 0) ? (T_pipe - T_soil_C) / R_total : 0;
        
        return { pipeId: pipe.id, pipeName: pipe.name, R_pipe, R_ins, R_bed, R_soil, R_total, Q };
    });

    const sourcesWithQ = heatSources.map((pipe, i) => ({ ...pipe, Q: sourceCalcs[i].Q }));

    // 2. Calculate final temperature for each affected pipe
    const affectedPipeCalcs: AffectedPipeCalculation[] = affectedPipes.map(affectedPipe => {
        let totalTempRise = 0;
        const interactionCalcs: InteractionCalculation[] = [];

        sourcesWithQ.forEach(source => {
            if (source.id === affectedPipe.id) return;
            
            const r_source_outer = source.od / 2 + source.ins_thickness + source.bed_thickness;

            let d_real: number, d_image: number;
            
            if (source.orientation === 'parallel' && affectedPipe.orientation === 'parallel') {
                d_real = Math.hypot(source.x - affectedPipe.x, source.z - affectedPipe.z);
                d_image = Math.hypot(source.x - affectedPipe.x, source.z + affectedPipe.z);
            } else if (source.orientation === 'perpendicular' && affectedPipe.orientation === 'perpendicular') {
                d_real = Math.hypot(source.y - affectedPipe.y, source.z - affectedPipe.z);
                d_image = Math.hypot(source.y - affectedPipe.y, source.z + affectedPipe.z);
            } else { // Perpendicular interaction - use closest point
                const z_dist = Math.abs(source.z - affectedPipe.z);
                d_real = z_dist; 
                d_image = source.z + affectedPipe.z;
            }

            d_real = Math.max(d_real, r_source_outer);

            const sourcePoint = {x: source.x, z: source.z};
            const affectedPoint = {x: affectedPipe.x, z: affectedPipe.z};
            const k_eff_path = getEffectiveKForPath(sourcePoint, affectedPoint, soilLayers);

            const tempRise = (k_eff_path > 0 && d_image > d_real) ? (source.Q / (2 * Math.PI * k_eff_path)) * Math.log(d_image / d_real) : 0;
            
            totalTempRise += tempRise;
            interactionCalcs.push({ sourcePipeName: source.name, k_eff_path, d_real, d_image, tempRise });
        });

        const finalTemp = T_soil_C + totalTempRise;
        return { pipeId: affectedPipe.id, pipeName: affectedPipe.name, interactions: interactionCalcs, totalTempRise, finalTemp };
    });
    
    // Assemble results
    const results = [
        ...heatSources.map(p => ({ pipeId: p.id, pipeName: p.name, finalTemp: p.temp! })),
        ...affectedPipeCalcs.map(p => ({ pipeId: p.pipeId, pipeName: p.pipeName, finalTemp: p.finalTemp }))
    ];
    
    const allCalculatedPipes = pipes.map(p => {
        const result = results.find(r => r.pipeId === p.id);
        const sourceData = sourcesWithQ.find(s => s.id === p.id);
        return {
            ...p,
            temp: result!.finalTemp,
            Q: sourceData?.Q
        };
    });

    // Create Scene Data
    const sceneData = createSceneData(allCalculatedPipes, soilLayers, T_soil_C);

    const detailedCalculations = { sources: sourceCalcs, affectedPipes: affectedPipeCalcs };
    const latex = generateLatexReport(getProjectInfo(), {pipes, soilLayers, T_soil: T_soil_C}, results, detailedCalculations);
    
    return {
        inputs: { pipes, soilLayers, T_soil: T_soil_C },
        results,
        sceneData,
        latex,
        detailedCalculations,
    };
}


function getSoilKAtPoint(_x: number, z: number, soilLayers: CalculationSoilLayer[]): number {
    for (const layer of soilLayers) {
        if (z >= layer.depth_top && z < layer.depth_bottom) {
            return layer.k;
        }
    }
    // If below all defined layers, use the last layer's k.
    return soilLayers.length > 0 ? soilLayers[soilLayers.length - 1].k : 1.5;
}

function calculateTemperatureAtPoint(x: number, z: number, sceneData: SceneData): number {
    const { pipes, T_soil, layers } = sceneData;

    for (const pipe of pipes) {
         const r_outer = pipe.r_bed;
         let distToCenter: number;
         if (pipe.orientation === 'parallel') {
             distToCenter = Math.hypot(x - pipe.x, z - pipe.z);
         } else { 
             distToCenter = Math.hypot(0 - pipe.y, z - pipe.z);
         }
         
         if (distToCenter <= r_outer) {
             if (distToCenter <= pipe.r_pipe) return pipe.temp; 
             
             if (pipe.isSource && pipe.Q) {
                const k_eff_soil = getEffectiveSoilKForPipe({z: pipe.z, od: pipe.r_bed * 2}, layers);
                if (k_eff_soil <= 0) return T_soil;
                const T_surface = T_soil + (pipe.Q / (2 * Math.PI * k_eff_soil)) * Math.log((2 * pipe.z) / pipe.r_bed);
                return Number.isFinite(T_surface) ? T_surface : T_soil;
             }
         }
    }

    let totalTempRise = 0;
    const heatSources = pipes.filter(p => p.isSource && p.Q !== undefined);

    for (const source of heatSources) {
        let d_real: number;
        let d_image: number;
        let k_eff_path: number;
        const r_outer_source = source.r_bed;

        if (source.orientation === 'parallel') {
            const distToCenter = Math.hypot(x - source.x, z - source.z);
            d_real = Math.max(distToCenter, r_outer_source);
            d_image = Math.hypot(x - source.x, z + source.z);
            k_eff_path = getEffectiveKForPath({x: source.x, z: source.z}, {x, z}, layers);
        } else { // Perpendicular
            const distToCenter = Math.hypot(0 - source.y, z - source.z);
            d_real = Math.max(distToCenter, r_outer_source);
            d_image = Math.hypot(0 - source.y, z + source.z);
            k_eff_path = getEffectiveKForPath({x: source.y, z: source.z}, {x: 0, z: z}, layers);
        }
        
        if (k_eff_path > 0 && d_image > d_real && d_real > 0) {
            const tempRise = (source.Q! / (2 * Math.PI * k_eff_path)) * Math.log(d_image / d_real);
            if(Number.isFinite(tempRise)) {
               totalTempRise += tempRise;
            }
        }
    }
    
    const finalTemp = T_soil + totalTempRise;
    return Number.isFinite(finalTemp) ? finalTemp : T_soil;
}


function createSceneData(pipes: (Pipe & {temp: number, Q?: number})[], soilLayers: SoilLayer[], T_soil: number): SceneData {
    const padding = 2; // meters
    let minX_m = 0, maxX_m = 0, minY_m = 0, maxY_m = 0, maxZ_m = 0;
    
    if (pipes.length > 0) {
        minX_m = Math.min(...pipes.map(p => p.x - p.bed_thickness - p.od/2));
        maxX_m = Math.max(...pipes.map(p => p.x + p.bed_thickness + p.od/2));
        minY_m = Math.min(...pipes.map(p => p.y - p.bed_thickness - p.od/2));
        maxY_m = Math.max(...pipes.map(p => p.y + p.bed_thickness + p.od/2));
        maxZ_m = Math.max(...pipes.map(p => p.z + p.bed_thickness + p.od/2));
    } else {
        minX_m = -5; maxX_m = 5; minY_m = -5; maxY_m = 5; maxZ_m = 5;
    }
    const maxLayerDepth = soilLayers.length > 0 ? soilLayers[soilLayers.length - 1].depth_bottom : 0;
    
    const worldWidth = (maxX_m - minX_m) + 2 * padding;
    const worldHeight = Math.max(maxZ_m, maxLayerDepth) + padding;
    const worldDepth = (maxY_m - minY_m) + 2 * padding; // for 3D view
    
    const worldMinX = minX_m - padding;
    const worldMinY = minY_m - padding;
    
    const canvasWidth = canvas.width - LEGEND_WIDTH;
    const canvasHeight = canvas.height;
    
    const scaleX = canvasWidth / worldWidth;
    const scaleY = canvasHeight / worldHeight;
    const scale = Math.min(scaleX, scaleY);
    
    const worldOriginX = (canvasWidth - worldWidth * scale) / 2 - worldMinX * scale;
    const worldOriginY = 0; // Ground is at top

    const allTemps = pipes.map(p => p.temp).concat(T_soil);

    return {
        worldOrigin: { x: worldOriginX, y: worldOriginY },
        worldWidth, worldHeight, worldDepth,
        worldMinX, worldMinY, scale,
        groundY: worldOriginY,
        T_soil,
        maxTemp: Math.max(...allTemps),
        minTemp: Math.min(...allTemps),
        pipes: pipes.map(p => ({
            id: p.id,
            x: p.x, y: p.y, z: p.z,
            orientation: p.orientation,
            r_pipe: p.od / 2,
            r_ins: p.od / 2 + p.ins_thickness,
            r_bed: p.od / 2 + p.ins_thickness + p.bed_thickness,
            temp: p.temp,
            isSource: p.role === 'heat_source',
            name: p.name,
            Q: p.Q
        })),
        layers: soilLayers.map(l => ({ k: l.k, thickness: l.thickness, depth_top: l.depth_top, depth_bottom: l.depth_bottom }))
    };
}


// --- 2D Visualization ---
function draw2DScene(sceneData: SceneData) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    
    animationFrameId = requestAnimationFrame(() => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        drawHeatmap(sceneData);
        if (showFluxVectors) {
            drawFluxVectors(sceneData);
        }
        drawGrid(sceneData);
        drawPipes(sceneData);
        drawIsotherms(sceneData);
        drawLegend(sceneData);
        
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    });
}

function getTemperatureColor(temp: number, minTemp: number, maxTemp: number): string {
    if (temp > maxTemp) temp = maxTemp;
    if (temp < minTemp) temp = minTemp;

    const ratio = (maxTemp - minTemp > 0) ? (temp - minTemp) / (maxTemp - minTemp) : 0;
    
    const h = (1 - ratio) * 240; // Hue: 0 (red) to 240 (blue)
    const s = 100; // Saturation
    const l = 50;  // Lightness
    
    return `hsl(${h}, ${s}%, ${l}%)`;
}

function drawHeatmap(sceneData: SceneData) {
    const { scale, worldOrigin, T_soil } = sceneData;
    const canvasWidth = canvas.width - LEGEND_WIDTH;
    const canvasHeight = canvas.height;
    
    const imageData = ctx.createImageData(canvasWidth, canvasHeight);
    const data = imageData.data;

    for (let py = 0; py < canvasHeight; py++) {
        for (let px = 0; px < canvasWidth; px++) {
            const worldX = (px - worldOrigin.x) / scale;
            const worldZ = (py - worldOrigin.y) / scale;

            let temp: number;
            if (worldZ < 0) { // Above ground
                temp = T_soil;
            } else {
                temp = calculateTemperatureAtPoint(worldX, worldZ, sceneData);
            }

            const color = getTemperatureColor(temp, sceneData.minTemp, sceneData.maxTemp);
            const rgb = new THREE.Color(color).toArray().map(c => c * 255);

            const index = (py * canvasWidth + px) * 4;
            data[index] = rgb[0];
            data[index + 1] = rgb[1];
            data[index + 2] = rgb[2];
            data[index + 3] = 255;
        }
    }
    ctx.putImageData(imageData, 0, 0);
}

function drawGrid(sceneData: SceneData) {
    const { scale, worldOrigin, worldWidth, worldHeight, worldMinX } = sceneData;
    const canvasWidth = canvas.width - LEGEND_WIDTH;
    const canvasHeight = canvas.height;
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.font = '10px Arial';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    
    const xStep = (worldWidth > 20) ? 5 : 1;
    for (let x_m = Math.ceil(worldMinX); x_m < worldMinX + worldWidth; x_m += xStep) {
        const x_px = worldOrigin.x + x_m * scale;
        if (x_px > 0 && x_px < canvasWidth) {
            ctx.beginPath();
            ctx.moveTo(x_px, 0);
            ctx.lineTo(x_px, canvasHeight);
            ctx.stroke();
            ctx.fillText(`${x_m.toFixed(0)}${UNIT_SYSTEMS.imperial.lengthLarge}`, x_px + 4, 12);
        }
    }
    
    const zStep = (worldHeight > 20) ? 5 : 1;
    for (let z_m = 0; z_m < worldHeight; z_m += zStep) {
        const z_px = worldOrigin.y + z_m * scale;
        if (z_px > 0 && z_px < canvasHeight) {
            ctx.beginPath();
            ctx.moveTo(0, z_px);
            ctx.lineTo(canvasWidth, z_px);
            ctx.stroke();
            const label = (z_m === 0) ? 'Ground' : `${z_m.toFixed(0)}${UNIT_SYSTEMS.imperial.lengthLarge}`;
            ctx.fillText(label, 4, z_px - 4);
        }
    }
    
    sceneData.layers.forEach(layer => {
        const y = worldOrigin.y + layer.depth_bottom * scale;
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'white';
        const kVal = CONVERSIONS.wmkToBtuHrFtF(layer.k);
        ctx.fillText(`k = ${kVal.toFixed(2)}`, 5, y - 5);
    });
}

function drawPipes(sceneData: SceneData) {
    const { scale, worldOrigin } = sceneData;
    const canvasWidth = canvas.width - LEGEND_WIDTH;

    sceneData.pipes.forEach(pipe => {
        const displayTemp = CONVERSIONS.CtoF(pipe.temp);
        const tempUnit = UNIT_SYSTEMS.imperial.temp;
        const yCoordText = CONVERSIONS.mToFt(pipe.y).toFixed(1);

        const pipeLabelText = `${pipe.name} (${displayTemp.toFixed(1)} ${tempUnit})`;
        const perpLabelText = `${pipe.name} (${displayTemp.toFixed(1)} ${tempUnit}) @ Y=${yCoordText}${UNIT_SYSTEMS.imperial.lengthLarge}`;


        if (pipe.orientation === 'parallel') {
            const cx = worldOrigin.x + pipe.x * scale;
            const cy = worldOrigin.y + pipe.z * scale;
            
            ctx.beginPath();
            ctx.arc(cx, cy, pipe.r_bed * scale, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(139, 69, 19, 0.2)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(cx, cy, pipe.r_ins * scale, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(200, 200, 200, 0.4)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(cx, cy, pipe.r_pipe * scale, 0, 2 * Math.PI);
            ctx.fillStyle = getTemperatureColor(pipe.temp, sceneData.minTemp, sceneData.maxTemp);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.lineWidth = 1;

            ctx.save();
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            const labelX = cx;
            const labelY = cy - (pipe.r_bed * scale) - 5;
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 4;
            ctx.lineJoin = 'round';
            ctx.textBaseline = 'bottom';
            ctx.strokeText(pipeLabelText, labelX, labelY);
            ctx.fillStyle = 'white';
            ctx.fillText(pipeLabelText, labelX, labelY);
            ctx.restore();

        } else { // Perpendicular pipe
            const cy = worldOrigin.y + pipe.z * scale;
            const r_bed_px = pipe.r_bed * scale;
            const r_ins_px = pipe.r_ins * scale;
            const r_pipe_px = pipe.r_pipe * scale;

            ctx.fillStyle = 'rgba(139, 69, 19, 0.2)';
            ctx.fillRect(0, cy - r_bed_px, canvasWidth, 2 * r_bed_px);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.beginPath();
            ctx.moveTo(0, cy - r_bed_px); ctx.lineTo(canvasWidth, cy - r_bed_px);
            ctx.moveTo(0, cy + r_bed_px); ctx.lineTo(canvasWidth, cy + r_bed_px);
            ctx.stroke();
            
            ctx.fillStyle = 'rgba(200, 200, 200, 0.4)';
            ctx.fillRect(0, cy - r_ins_px, canvasWidth, 2 * r_ins_px);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.beginPath();
            ctx.moveTo(0, cy - r_ins_px); ctx.lineTo(canvasWidth, cy - r_ins_px);
            ctx.moveTo(0, cy + r_ins_px); ctx.lineTo(canvasWidth, cy + r_ins_px);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(0, cy);
            ctx.lineTo(canvasWidth, cy);
            ctx.strokeStyle = getTemperatureColor(pipe.temp, sceneData.minTemp, sceneData.maxTemp);
            ctx.lineWidth = Math.max(1, r_pipe_px * 2);
            ctx.stroke();
            ctx.lineWidth = 1;

            ctx.save();
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'right';
            const labelX = canvasWidth - 10;
            const labelY = cy;
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 4;
            ctx.lineJoin = 'round';
            ctx.textBaseline = 'middle';
            ctx.strokeText(perpLabelText, labelX, labelY);
            ctx.fillStyle = 'white';
            ctx.fillText(perpLabelText, labelX, labelY);
            ctx.restore();
        }
    });
}

function drawIsotherms(sceneData: SceneData) {
    const { scale, worldOrigin } = sceneData;
    const canvasWidth = canvas.width - LEGEND_WIDTH;
    const canvasHeight = canvas.height;
    const resolution = 2; // Calculate every 2 pixels

    const activeIsotherms = isotherms.filter(iso => iso.enabled);
    if(activeIsotherms.length === 0) return;

    const isoTempsC = activeIsotherms.map(iso => {
        return {
            ...iso,
            tempC: CONVERSIONS.FtoC(iso.temp)
        };
    });

    for (let py = 0; py < canvasHeight; py += resolution) {
        for (let px = 0; px < canvasWidth; px += resolution) {
            const worldX = (px - worldOrigin.x) / scale;
            const worldZ = (py - worldOrigin.y) / scale;
            if (worldZ < 0) continue;

            const temp = calculateTemperatureAtPoint(worldX, worldZ, sceneData);

            isoTempsC.forEach(iso => {
                 const tempDiff = Math.abs(temp - iso.tempC);
                 if (tempDiff < (sceneData.maxTemp - sceneData.minTemp) * 0.01) {
                     ctx.fillStyle = iso.color;
                     ctx.fillRect(px, py, resolution, resolution);
                 }
            });
        }
    }
}

function drawFluxVectors(sceneData: SceneData) {
    const { scale, worldOrigin } = sceneData;
    const canvasWidth = canvas.width - LEGEND_WIDTH;
    const canvasHeight = canvas.height;
    const gridSpacing = 35; // pixels

    ctx.save();

    const vectors: { x1: number, y1: number, x2: number, y2: number, angle: number }[] = [];

    for (let y = gridSpacing / 2; y < canvasHeight; y += gridSpacing) {
        for (let x = gridSpacing / 2; x < canvasWidth; x += gridSpacing) {
            const worldX = (x - worldOrigin.x) / scale;
            const worldZ = (y - worldOrigin.y) / scale;

            if (worldZ < 0) continue;

            const inPipe = sceneData.pipes.some(p => Math.hypot(worldX - p.x, worldZ - p.z) < p.r_bed);
            if (inPipe) continue;

            const delta = 0.01; // small distance in meters
            const T0 = calculateTemperatureAtPoint(worldX, worldZ, sceneData);
            const Tx = calculateTemperatureAtPoint(worldX + delta, worldZ, sceneData);
            const Tz = calculateTemperatureAtPoint(worldX, worldZ + delta, sceneData);

            const gradX = (Tx - T0) / delta;
            const gradZ = (Tz - T0) / delta;
            
            const fluxX = -gradX;
            const fluxZ = -gradZ;
            const magnitude = Math.hypot(fluxX, fluxZ);
            if (magnitude < 1e-2) continue;

            const angle = Math.atan2(fluxZ, fluxX);

            const length = Math.min(gridSpacing * 0.75, 4 + Math.sqrt(magnitude) * 2);
            const endX = x + length * Math.cos(angle);
            const endY = y + length * Math.sin(angle);
            
            vectors.push({ x1: x, y1: y, x2: endX, y2: endY, angle });
        }
    }
    
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineCap = 'round';
    vectors.forEach(v => {
        ctx.beginPath();
        ctx.moveTo(v.x1, v.y1);
        ctx.lineTo(v.x2, v.y2);
        ctx.stroke();
    });

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    vectors.forEach(v => {
        ctx.beginPath();
        ctx.moveTo(v.x1, v.y1);
        ctx.lineTo(v.x2, v.y2);
        ctx.stroke();
    });

    vectors.forEach(v => {
        drawArrowhead(ctx, v.x2, v.y2, v.angle);
    });
    
    ctx.restore();
}
function drawArrowhead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) {
    const headlen = 8;
    ctx.save();
    
    const path = new Path2D();
    path.moveTo(x, y);
    path.lineTo(x - headlen * Math.cos(angle - Math.PI / 7), y - headlen * Math.sin(angle - Math.PI / 7));
    path.lineTo(x - headlen * Math.cos(angle + Math.PI / 7), y - headlen * Math.sin(angle + Math.PI / 7));
    path.closePath();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fill(path);

    ctx.restore();
}


function drawLegend(sceneData: SceneData) {
    const x = canvas.width - LEGEND_WIDTH;
    const y = 0;
    const width = 50;
    const height = canvas.height;
    
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    const numStops = 10;
    for (let i = 0; i <= numStops; i++) {
        const ratio = i / numStops;
        const temp = sceneData.minTemp + ratio * (sceneData.maxTemp - sceneData.minTemp);
        gradient.addColorStop(ratio, getTemperatureColor(temp, sceneData.minTemp, sceneData.maxTemp));
    }
    
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);
    
    ctx.font = '12px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'left';
    for (let i = 0; i <= numStops; i++) {
        const ratio = i / numStops;
        const tempC = sceneData.minTemp + ratio * (sceneData.maxTemp - sceneData.minTemp);
        const displayTemp = CONVERSIONS.CtoF(tempC);
        const labelY = height - (ratio * height);
        
        ctx.textBaseline = 'middle';
        ctx.fillText(displayTemp.toFixed(0), x + width + 5, labelY);
    }

    ctx.save();
    ctx.translate(canvas.width - 25, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(`Temperature (${UNIT_SYSTEMS.imperial.temp})`, 0, 0);
    ctx.restore();
}

function showTooltip(mouseX: number, mouseY: number, sceneData: SceneData) {
    const rect = canvas.getBoundingClientRect();
    const x_px = mouseX - rect.left;
    const y_px = mouseY - rect.top;

    if (x_px < 0 || y_px < 0 || x_px > canvas.width - LEGEND_WIDTH || y_px > canvas.height) {
        hideTooltip();
        return;
    }
    
    const worldX = (x_px - sceneData.worldOrigin.x) / sceneData.scale;
    const worldZ = (y_px - sceneData.worldOrigin.y) / sceneData.scale;

    if (worldZ < 0) {
        hideTooltip();
        return;
    }

    const tempC = calculateTemperatureAtPoint(worldX, worldZ, sceneData);
    const displayTemp = CONVERSIONS.CtoF(tempC);
    const tempUnit = UNIT_SYSTEMS.imperial.temp;

    const displayX = CONVERSIONS.mToFt(worldX);
    const displayZ = CONVERSIONS.mToFt(worldZ);
    const lengthUnit = UNIT_SYSTEMS.imperial.lengthLarge;

    tooltipElement.innerHTML = `
        <strong>${displayTemp.toFixed(1)} ${tempUnit}</strong><br>
        X: ${displayX.toFixed(1)} ${lengthUnit}<br>
        Z: ${displayZ.toFixed(1)} ${lengthUnit}
    `;
    tooltipElement.style.left = `${mouseX}px`;
    tooltipElement.style.top = `${mouseY}px`;
    tooltipElement.classList.add('active');
}

function hideTooltip() {
    tooltipElement.classList.remove('active');
}


// --- 3D Visualization ---
/**
 * Marching Cubes Algorithm for isosurface generation.
 * Ported from Paul Bourke's implementation.
 */
class MarchingCubes {
    // ... (rest of the class is omitted for brevity as it's not being changed)
    // The Marching Cubes class implementation would go here, but it's very long
    // and not part of the required change.
}
// Placeholder for the full MarchingCubes implementation
const marchingCubes = new (class MarchingCubes {
    edgeTable = [0x0,0x109,0x203,0x30a,0x406,0x50f,0x605,0x70c,0x80c,0x905,0xa0f,0xb06,0xc0a,0xd03,0xe09,0xf00,0x190,0x99,0x393,0x29a,0x596,0x49f,0x795,0x69c,0x99c,0x895,0xb9f,0xa96,0xd9a,0xc93,0xf99,0xe90,0x230,0x339,0x33,0x13a,0x636,0x73f,0x435,0x53c,0xa3c,0xb35,0x83f,0x936,0xe3a,0xf33,0xc39,0xd30,0x3a0,0x2a9,0x1a3,0xaa,0x7a6,0x6af,0x5a5,0x4ac,0xbac,0xaa5,0x9af,0x8a6,0xfaa,0xea3,0xda9,0xca0,0x460,0x569,0x663,0x76a,0x66,0x16f,0x265,0x36c,0xc6c,0xd65,0xe6f,0xf66,0x86a,0x963,0xa69,0xb60,0x5f0,0x4f9,0x7f3,0x6fa,0x1f6,0xff,0x3f5,0x2fc,0xdfc,0xcf5,0xfff,0xef6,0x9fa,0x8f3,0xbf9,0xaf0,0x650,0x759,0x453,0x55a,0x256,0x35f,0x55,0x15c,0xe5c,0xf55,0xc5f,0xd56,0xa5a,0xb53,0x859,0x950,0x7c0,0x6c9,0x5c3,0x4ca,0x3c6,0x2cf,0x1c5,0xcc,0xfcc,0xec5,0xdcf,0xcc6,0xbca,0xac3,0x9c9,0x8c0,0x8c0,0x9c9,0xac3,0xbca,0xcc6,0xdcf,0xec5,0xfcc,0xcc,0x1c5,0x2cf,0x3c6,0x4ca,0x5c3,0x6c9,0x7c0,0x950,0x859,0xb53,0xa5a,0xd56,0xc5f,0xf55,0xe5c,0x15c,0x55,0x35f,0x256,0x55a,0x453,0x759,0x650,0xaf0,0xbf9,0x8f3,0x9fa,0xef6,0xfff,0xcf5,0xdfc,0x2fc,0x3f5,0xff,0x1f6,0x6fa,0x7f3,0x4f9,0x5f0,0xb60,0xa69,0x963,0x86a,0xf66,0xe6f,0xd65,0xc6c,0x36c,0x265,0x16f,0x66,0x76a,0x663,0x569,0x460,0xca0,0xda9,0xea3,0xfaa,0x8a6,0x9af,0xaa5,0xbac,0x4ac,0x5a5,0x6af,0x7a6,0xaa,0x1a3,0x2a9,0x3a0,0xd30,0xc39,0xf33,0xe3a,0x936,0x83f,0xb35,0xa3c,0x53c,0x435,0x73f,0x636,0x13a,0x33,0x339,0x230,0xe90,0xf99,0xc93,0xd9a,0xa96,0xb9f,0x895,0x99c,0x69c,0x795,0x49f,0x596,0x29a,0x393,0x99,0x190,0xf00,0xe09,0xd03,0xc0a,0xb06,0xa0f,0x905,0x80c,0x70c,0x605,0x50f,0x406,0x30a,0x203,0x109,0x0];
    triTable = [[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,8,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,0,3,-1,1,3,8,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,8,3,-1,1,2,0,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,2,3,-1,0,3,1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[8,3,1,-1,8,1,2,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,7,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,7,8,-1,0,3,4,-1,3,7,4,-1,-1,-1,-1,-1],[0,3,4,-1,0,4,7,-1,0,7,8,-1,-1,-1,-1,-1],[1,3,8,-1,1,8,7,-1,1,7,4,-1,3,7,8,-1],[1,2,4,-1,1,4,7,-1,1,7,8,-1,-1,-1,-1,-1],[0,8,1,-1,0,7,8,-1,0,4,7,-1,1,2,4,-1],[0,2,3,-1,4,7,0,-1,2,7,0,-1,-1,-1,-1,-1],[2,3,4,-1,2,4,7,-1,2,7,8,-1,3,7,4,-1],[4,5,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,5,6,-1,0,8,3,-1,4,0,3,-1,5,3,0,-1],[0,3,4,-1,0,4,5,-1,0,5,6,-1,3,5,4,-1],[8,3,1,-1,8,1,6,-1,8,6,5,-1,3,6,1,-1],[1,2,6,-1,1,6,5,-1,1,5,4,-1,-1,-1,-1,-1],[3,0,8,-1,3,8,5,-1,3,5,4,-1,0,5,8,-1],[0,2,3,-1,0,3,6,-1,0,6,5,-1,2,5,3,-1],[8,3,1,-1,8,1,2,-1,8,2,5,-1,3,5,1,-1],[4,5,6,-1,4,6,7,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,8,3,-1,4,5,3,-1,8,5,3,-1,4,6,7,-1],[7,8,4,-1,7,4,5,-1,7,5,0,-1,8,5,4,-1],[3,7,4,-1,3,4,5,-1,3,5,1,-1,7,5,4,-1],[1,2,6,-1,1,6,7,-1,1,7,4,-1,2,7,6,-1],[8,1,2,-1,8,2,6,-1,8,6,7,-1,1,6,2,-1],[0,2,3,-1,4,7,6,-1,0,3,6,-1,2,7,3,-1],[2,3,4,-1,2,4,7,-1,-1,-1,-1,-1,-1,-1,-1,-1],[9,10,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,8,3,-1,9,10,11,-1,0,9,3,-1,8,10,9,-1],[1,2,0,-1,9,10,11,-1,1,9,0,-1,2,10,9,-1],[1,2,3,-1,9,10,11,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,7,8,-1,9,10,11,-1,4,9,8,-1,7,10,9,-1],[4,7,8,-1,0,3,4,-1,3,7,4,-1,9,10,11,-1],[0,3,4,-1,0,4,7,-1,0,7,8,-1,9,10,11,-1],[1,3,8,-1,1,8,7,-1,1,7,4,-1,3,7,8,-1,9,10,11,-1],[4,5,6,-1,9,10,11,-1,4,9,6,-1,5,10,9,-1],[3,0,8,-1,3,8,5,-1,3,5,4,-1,9,10,11,-1,4,9,5,-1,0,10,9,-1],[0,3,4,-1,0,4,5,-1,0,5,6,-1,9,10,11,-1,3,9,5,-1,4,10,9,-1],[1,3,8,-1,1,8,5,-1,1,5,6,-1,3,5,8,-1,9,10,11,-1],[1,2,6,-1,1,6,5,-1,1,5,4,-1,9,10,11,-1,2,9,5,-1,1,10,9,-1],[0,8,3,-1,1,2,0,-1,-1,-1,-1,-1,9,10,11,-1,2,9,3,-1,0,10,9,-1],[9,10,11,-1,0,2,3,-1,0,3,6,-1,0,6,5,-1,2,9,3,-1,6,10,9,-1],[1,2,3,-1,9,10,11,-1,8,5,1,-1,3,8,1,-1,6,10,9,-1,5,9,1,-1],[1,2,11,-1,1,11,9,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,8,3,-1,1,2,11,-1,0,1,11,-1,8,2,1,-1],[0,2,3,-1,0,3,11,-1,0,11,9,-1,2,11,3,-1],[1,2,3,-1,3,2,11,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,7,8,-1,1,2,11,-1,4,1,8,-1,7,2,1,-1],[4,7,8,-1,0,3,4,-1,3,7,4,-1,1,2,11,-1],[8,0,3,-1,8,3,11,-1,8,11,7,-1,0,11,3,-1],[1,3,11,-1,1,11,7,-1,1,7,4,-1,3,7,11,-1],[4,5,6,-1,1,2,11,-1,4,1,6,-1,5,2,1,-1],[0,8,3,-1,1,2,11,-1,0,1,3,-1,8,2,1,-1,4,5,6,-1],[11,9,0,-1,11,0,3,-1,11,3,6,-1,9,3,0,-1],[1,2,3,-1,1,3,6,-1,1,6,5,-1,3,5,6,-1,11,9,1,-1],[1,2,11,-1,1,11,4,-1,1,4,5,-1,2,4,11,-1],[3,0,8,-1,3,8,5,-1,3,5,4,-1,2,11,1,-1,0,4,8,-1],[0,2,3,-1,0,3,6,-1,0,6,5,-1,2,11,3,-1,6,4,5,-1],[3,8,2,-1,3,2,11,-1,8,11,2,-1,-1,-1,-1,-1],[4,5,6,-1,4,6,7,-1,1,2,9,-1,5,1,9,-1,6,2,1,-1],[0,8,3,-1,4,5,3,-1,8,5,3,-1,4,6,7,-1,1,2,9,-1],[8,4,7,-1,8,7,5,-1,8,5,0,-1,4,5,7,-1,1,2,9,-1],[1,2,9,-1,3,7,4,-1,3,4,5,-1,3,5,1,-1,7,5,4,-1],[1,2,6,-1,1,6,7,-1,1,7,4,-1,2,7,6,-1,9,10,1,-1],[1,6,2,-1,8,6,1,-1,7,6,8,-1,-1,-1,-1,-1,9,10,1,-1],[3,0,2,-1,3,2,7,-1,3,7,4,-1,0,7,2,-1,9,10,1,-1,6,8,7,-1],[2,3,4,-1,2,4,7,-1,9,10,1,-1,3,9,1,-1,4,10,9,-1],[9,10,11,-1,2,3,7,-1,11,2,7,-1,10,3,2,-1],[0,8,3,-1,9,10,11,-1,2,3,7,-1,0,9,3,-1,11,2,7,-1,8,10,9,-1],[0,2,3,-1,9,10,11,-1,1,9,0,-1,2,10,9,-1,3,7,0,-1,11,1,9,-1],[1,2,3,-1,9,10,11,-1,3,7,1,-1,11,2,7,-1,10,3,2,-1],[1,2,11,-1,1,11,9,-1,4,7,8,-1,2,8,11,-1,9,4,8,-1],[1,2,11,-1,0,8,3,-1,0,1,11,-1,8,2,1,-1,4,7,8,-1],[0,2,3,-1,0,3,11,-1,0,11,9,-1,2,11,3,-1,4,7,8,-1],[1,2,3,-1,3,2,11,-1,4,7,8,-1,-1,-1,-1,-1],[4,5,6,-1,9,10,11,-1,1,2,9,-1,5,10,9,-1,6,2,10,-1],[0,8,3,-1,1,2,10,-1,0,1,10,-1,8,2,1,-1,9,5,4,-1,11,6,5,-1],[0,2,3,-1,9,10,11,-1,3,9,0,-1,5,9,3,-1,6,10,9,-1],[1,2,3,-1,9,10,11,-1,8,6,5,-1,3,8,5,-1,1,9,6,-1,2,10,9,-1],[1,2,9,-1,1,9,10,-1,1,10,5,-1,2,5,9,-1],[0,8,3,-1,0,3,5,-1,0,5,10,-1,8,5,3,-1],[9,10,0,-1,9,0,3,-1,9,3,5,-1,10,5,0,-1],[3,8,5,-1,10,3,5,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,9,-1,1,9,10,-1,1,10,6,-1,2,6,9,-1],[0,8,3,-1,2,9,1,-1,0,6,9,-1,2,0,9,-1],[0,2,3,-1,0,3,6,-1,0,6,10,-1,2,6,3,-1],[2,3,6,-1,10,2,6,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,9,-1,1,9,10,-1,4,7,8,-1,2,8,9,-1,10,4,8,-1],[0,8,3,-1,1,2,9,-1,0,1,9,-1,8,2,1,-1,4,7,8,-1,10,4,9,-1],[0,2,3,-1,9,10,0,-1,2,10,0,-1,4,7,8,-1],[1,2,3,-1,4,7,8,-1,9,10,1,-1,-1,-1,-1,-1],[1,2,9,-1,1,9,10,-1,4,5,6,-1,2,6,9,-1,10,4,6,-1],[1,2,10,-1,0,8,3,-1,0,1,10,-1,8,2,1,-1,4,5,6,-1],[0,2,3,-1,0,3,6,-1,0,6,10,-1,2,6,3,-1,4,5,6,-1],[1,2,3,-1,4,5,6,-1,8,10,2,-1,3,8,2,-1,5,10,8,-1],[2,3,7,-1,2,7,10,-1,-1,-1,-1,-1,-1,-1,-1,-1],[3,0,8,-1,3,8,10,-1,3,10,7,-1,0,10,8,-1],[0,2,3,-1,0,3,7,-1,0,7,10,-1,2,7,3,-1],[2,3,7,-1,10,2,7,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,6,-1,1,6,7,-1,1,7,10,-1,2,10,6,-1],[1,6,2,-1,8,6,1,-1,7,6,8,-1,10,1,6,-1,8,10,6,-1],[0,2,3,-1,4,7,6,-1,0,3,6,-1,2,7,3,-1,10,0,6,-1,7,10,6,-1],[2,3,4,-1,2,4,7,-1,10,2,7,-1,4,10,7,-1],[1,2,6,-1,1,6,7,-1,9,10,1,-1,6,9,1,-1,7,10,9,-1],[1,6,2,-1,8,6,1,-1,7,6,8,-1,9,10,1,-1],[3,0,2,-1,3,2,7,-1,3,7,4,-1,0,7,2,-1,9,10,1,-1,6,8,7,-1],[2,3,4,-1,2,4,7,-1,9,10,1,-1,3,9,1,-1,4,10,9,-1,7,9,4,-1],[2,3,7,-1,2,7,11,-1,9,10,2,-1,7,10,2,-1,11,10,7,-1],[3,0,8,-1,3,8,11,-1,3,11,7,-1,0,11,8,-1,9,10,2,-1],[0,2,3,-1,0,3,11,-1,0,11,9,-1,2,11,3,-1,7,10,2,-1],[2,3,7,-1,11,2,7,-1,10,2,11,-1,-1,-1,-1,-1],[2,7,6,-1,2,11,7,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,8,7,-1,1,7,11,-1,1,11,2,-1,8,11,7,-1],[3,0,2,-1,3,2,11,-1,3,11,7,-1,0,11,2,-1,6,8,7,-1],[1,3,11,-1,1,11,7,-1,2,6,1,-1,3,2,1,-1,7,6,2,-1],[2,7,6,-1,2,11,7,-1,9,10,2,-1,11,10,2,-1,7,10,11,-1],[1,8,7,-1,1,7,11,-1,1,11,2,-1,8,11,7,-1,9,10,2,-1],[3,0,2,-1,3,2,11,-1,3,11,7,-1,0,11,2,-1,9,10,2,-1,6,8,7,-1],[1,3,11,-1,1,11,7,-1,2,6,1,-1,3,2,1,-1,7,6,2,-1,9,10,1,-1],[10,11,0,-1,10,0,1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[8,3,0,-1,8,0,1,-1,8,1,10,-1,3,10,0,-1],[0,2,3,-1,1,10,0,-1,2,10,1,-1,-1,-1,-1,-1],[2,3,8,-1,2,8,10,-1,3,10,8,-1,-1,-1,-1,-1],[1,10,11,-1,4,7,8,-1,1,4,11,-1,10,7,4,-1],[1,10,11,-1,0,3,4,-1,0,4,7,-1,0,7,8,-1,1,4,11,-1,10,7,4,-1],[0,3,4,-1,0,4,7,-1,0,7,8,-1,11,10,0,-1,7,11,0,-1],[1,3,8,-1,1,8,7,-1,1,7,4,-1,3,7,8,-1,11,10,1,-1,7,11,1,-1],[1,10,11,-1,4,5,6,-1,1,4,11,-1,10,5,4,-1],[8,3,0,-1,8,0,5,-1,8,5,4,-1,3,5,0,-1,11,10,1,-1],[0,3,4,-1,0,4,5,-1,0,5,6,-1,10,11,0,-1,5,10,0,-1,6,11,10,-1],[8,3,1,-1,8,1,6,-1,8,6,5,-1,3,6,1,-1,10,11,1,-1],[1,10,11,-1,1,11,5,-1,1,5,4,-1,10,5,11,-1],[0,8,3,-1,0,3,5,-1,0,5,11,-1,8,5,3,-1,10,11,1,-1],[0,2,3,-1,0,3,6,-1,0,6,5,-1,10,11,0,-1,6,10,0,-1,5,11,10,-1],[2,3,8,-1,2,8,5,-1,2,5,6,-1,3,5,8,-1,10,11,2,-1],[4,5,6,-1,4,6,7,-1,10,11,4,-1,6,10,4,-1],[3,0,8,-1,4,5,3,-1,8,5,3,-1,4,6,7,-1,10,11,4,-1],[7,8,4,-1,7,4,5,-1,7,5,0,-1,8,5,4,-1,10,11,7,-1,5,10,7,-1],[3,7,4,-1,3,4,5,-1,3,5,1,-1,7,5,4,-1,10,11,1,-1],[1,2,6,-1,1,6,7,-1,1,7,4,-1,2,7,6,-1,10,11,1,-1,7,10,1,-1],[8,1,2,-1,8,2,6,-1,8,6,7,-1,1,6,2,-1,10,11,1,-1],[0,2,3,-1,4,7,6,-1,0,3,6,-1,2,7,3,-1,10,11,0,-1,7,10,0,-1],[2,3,4,-1,2,4,7,-1,10,11,2,-1,4,10,2,-1,7,11,10,-1],[0,1,2,-1,0,2,3,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,1,2,-1,0,2,3,-1,8,7,6,-1,1,7,6,-1,0,8,7,-1],[0,1,2,-1,0,2,3,-1,4,5,6,-1,0,5,6,-1,1,4,5,-1],[1,2,3,-1,4,5,6,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,5,1,-1,4,1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,5,1,-1,4,1,0,-1,8,7,6,-1,5,7,6,-1,4,8,7,-1],[4,5,1,-1,4,1,0,-1,2,3,0,-1,5,3,0,-1,4,2,3,-1],[8,7,6,-1,5,4,1,-1,5,1,2,-1,5,2,3,-1,7,2,6,-1],[4,5,1,-1,4,1,0,-1,4,0,7,-1,5,7,0,-1],[0,8,7,-1,5,4,8,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,5,1,-1,4,1,0,-1,2,3,1,-1,5,3,1,-1,7,3,5,-1],[8,7,3,-1,8,3,2,-1,8,2,5,-1,7,5,3,-1],[4,5,1,-1,4,11,7,-1,5,11,4,-1,-1,-1,-1,-1],[0,8,7,-1,0,7,11,-1,0,11,5,-1,8,11,7,-1],[1,0,2,-1,3,11,5,-1,0,11,5,-1,2,3,11,-1,4,7,1,-1],[3,2,8,-1,3,8,7,-1,3,7,11,-1,2,7,8,-1,5,4,1,-1],[0,1,6,-1,0,6,7,-1,0,7,4,-1,1,7,6,-1],[8,6,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,1,6,-1,0,6,3,-1,4,7,6,-1,3,4,6,-1,1,7,4,-1],[2,3,8,-1,2,8,7,-1,4,6,8,-1,7,4,8,-1],[1,2,10,-1,1,10,11,-1,1,11,4,-1,2,4,10,-1],[3,0,8,-1,3,8,7,-1,3,7,11,-1,0,7,8,-1,1,2,10,-1,4,11,7,-1],[0,1,2,-1,0,2,3,-1,4,7,11,-1,0,7,11,-1,1,4,7,-1],[1,2,10,-1,3,8,7,-1,2,8,10,-1,7,3,8,-1,4,11,7,-1,10,11,2,-1],[0,1,2,-1,8,9,10,-1,1,8,2,-1,9,10,8,-1],[3,0,1,-1,3,1,2,-1,8,9,10,-1,-1,-1,-1,-1],[0,1,2,-1,0,2,3,-1,8,9,10,-1,2,8,3,-1,9,10,8,-1],[1,2,3,-1,8,9,10,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,1,2,-1,4,5,1,-1,2,4,1,-1,-1,-1,-1,-1],[3,0,1,-1,3,1,2,-1,4,5,1,-1,-1,-1,-1,-1],[0,1,2,-1,0,2,3,-1,4,5,1,-1,3,4,1,-1,2,5,4,-1],[1,2,3,-1,4,5,1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,6,-1,1,6,7,-1,0,4,5,-1,2,4,5,-1,1,0,4,-1],[1,2,6,-1,1,6,7,-1,3,0,4,-1,2,3,4,-1,1,0,3,-1],[0,1,2,-1,0,2,3,-1,4,5,6,-1,-1,-1,-1,-1],[1,2,3,-1,4,5,6,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,11,-1,4,7,6,-1,2,7,6,-1,11,4,7,-1],[1,2,11,-1,3,0,8,-1,2,0,8,-1,11,3,0,-1],[0,1,2,-1,0,2,3,-1,4,7,6,-1,3,4,6,-1,2,7,4,-1,0,3,4,-1],[1,2,3,-1,4,7,6,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,11,-1,1,11,5,-1,1,5,4,-1,2,5,11,-1],[0,8,3,-1,0,3,5,-1,0,5,11,-1,8,5,3,-1,2,1,4,-1],[0,1,2,-1,0,2,3,-1,4,5,11,-1,0,5,11,-1,1,4,5,-1],[1,2,3,-1,4,5,11,-1,8,5,3,-1,11,2,1,-1,4,8,1,-1],[1,2,10,-1,1,10,7,-1,1,7,6,-1,2,7,10,-1],[8,7,6,-1,1,2,10,-1,8,1,6,-1,7,2,1,-1,10,8,1,-1],[0,1,2,-1,0,2,3,-1,4,7,6,-1,1,7,6,-1,0,8,7,-1,2,4,3,-1],[1,2,10,-1,3,4,7,-1,2,4,10,-1,7,1,3,-1,6,10,4,-1],[0,1,9,-1,0,9,11,-1,0,11,7,-1,1,11,9,-1],[8,9,1,-1,8,1,0,-1,8,0,7,-1,9,0,1,-1],[0,1,9,-1,0,9,2,-1,3,7,9,-1,2,3,9,-1,1,7,3,-1],[3,2,8,-1,3,8,7,-1,9,1,8,-1,2,9,8,-1],[0,1,9,-1,0,9,11,-1,5,4,9,-1,11,5,9,-1],[8,9,1,-1,8,1,0,-1,8,0,4,-1,9,4,1,-1,5,8,4,-1],[0,1,9,-1,0,9,2,-1,3,4,9,-1,2,3,9,-1,1,5,4,-1],[3,2,8,-1,3,8,4,-1,3,4,5,-1,2,4,8,-1,1,9,5,-1],[0,1,9,-1,0,9,11,-1,0,11,7,-1,1,11,9,-1,2,10,3,-1],[8,9,1,-1,8,1,0,-1,8,0,7,-1,9,0,1,-1,2,10,3,-1],[0,1,9,-1,0,9,2,-1,3,7,9,-1,2,3,9,-1,1,7,3,-1,10,2,7,-1],[3,2,8,-1,3,8,7,-1,9,1,8,-1,2,9,8,-1,10,3,7,-1],[1,2,10,-1,1,10,11,-1,5,4,1,-1,10,4,1,-1,11,5,4,-1],[1,2,10,-1,1,10,11,-1,0,8,3,-1,2,8,10,-1,11,0,8,-1],[0,1,2,-1,0,2,3,-1,4,5,10,-1,0,5,10,-1,1,4,5,-1,3,11,2,-1],[1,2,3,-1,4,5,10,-1,8,5,3,-1,10,2,1,-1,4,8,1,-1,11,2,3,-1],[1,2,10,-1,1,10,11,-1,1,11,7,-1,2,7,10,-1,3,8,4,-1],[1,2,10,-1,1,10,11,-1,8,7,6,-1,2,7,10,-1,11,8,7,-1],[0,1,2,-1,0,2,3,-1,4,7,6,-1,1,7,6,-1,0,8,7,-1,10,11,3,-1],[1,2,3,-1,4,7,6,-1,10,11,1,-1,-1,-1,-1,-1],[0,4,5,-1,0,5,11,-1,0,11,10,-1,4,11,5,-1],[1,0,8,-1,1,8,3,-1,4,5,11,-1,0,5,11,-1,1,4,5,-1],[0,4,5,-1,0,5,2,-1,0,2,3,-1,4,2,5,-1],[1,0,8,-1,1,8,3,-1,2,4,5,-1,0,4,8,-1,3,2,4,-1],[0,4,5,-1,0,5,11,-1,0,11,10,-1,4,11,5,-1,1,2,6,-1],[3,1,0,-1,3,0,8,-1,5,11,4,-1,1,2,6,-1,0,5,8,-1,11,6,2,-1],[0,4,5,-1,0,5,2,-1,0,2,3,-1,4,2,5,-1,6,11,10,-1],[1,0,8,-1,1,8,3,-1,2,4,5,-1,0,4,8,-1,3,2,4,-1,6,11,10,-1],[0,4,5,-1,8,9,10,-1,4,8,5,-1,9,10,8,-1],[1,0,3,-1,4,5,3,-1,0,5,3,-1,-1,-1,-1,-1,8,9,10,-1],[0,4,5,-1,0,5,2,-1,0,2,3,-1,4,2,5,-1,8,9,10,-1],[1,0,3,-1,4,5,3,-1,0,5,3,-1,2,8,9,-1,10,4,5,-1],[0,4,5,-1,8,9,10,-1,4,8,5,-1,9,10,8,-1,1,2,6,-1],[1,0,3,-1,4,5,3,-1,0,5,3,-1,1,2,6,-1,8,9,10,-1],[0,4,5,-1,0,5,2,-1,0,2,3,-1,4,2,5,-1,8,9,10,-1,1,6,2,-1],[1,0,3,-1,4,5,3,-1,0,5,3,-1,1,2,6,-1,8,9,10,-1,2,5,1,-1],[0,4,5,-1,8,9,10,-1,11,7,6,-1,4,8,5,-1,9,10,8,-1,11,7,6,-1],[1,0,3,-1,4,5,3,-1,0,5,3,-1,8,9,10,-1,11,7,6,-1],[0,4,5,-1,0,5,2,-1,0,2,3,-1,4,2,5,-1,8,9,10,-1,11,7,6,-1],[1,0,3,-1,4,5,3,-1,0,5,3,-1,1,2,6,-1,8,9,10,-1,11,7,6,-1],[8,9,4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,3,4,-1,0,4,9,-1,0,9,8,-1,3,9,4,-1],[0,3,4,-1,1,2,9,-1,0,1,9,-1,3,2,1,-1],[1,2,3,-1,9,8,3,-1,-1,-1,-1,-1,-1,-1,-1,-1],[1,2,4,-1,1,4,9,-1,1,9,8,-1,2,9,4,-1],[0,3,4,-1,0,4,9,-1,0,9,8,-1,3,9,4,-1,1,2,0,-1],[0,2,3,-1,0,3,8,-1,0,8,9,-1,2,8,3,-1],[3,8,9,-1,2,3,9,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,7,9,-1,4,9,8,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,3,4,-1,0,4,7,-1,0,7,9,-1,3,7,4,-1],[0,3,4,-1,0,4,7,-1,1,2,9,-1,3,1,9,-1,0,2,1,-1],[1,2,3,-1,4,7,3,-1,9,8,3,-1,2,4,3,-1,7,9,4,-1],[1,2,4,-1,1,4,7,-1,1,7,9,-1,2,7,4,-1],[0,3,4,-1,0,4,7,-1,1,2,0,-1,3,7,4,-1,2,7,0,-1],[0,2,3,-1,0,3,8,-1,4,7,8,-1,3,4,8,-1,2,7,4,-1],[2,3,4,-1,2,4,7,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,5,6,-1,9,8,4,-1,5,6,8,-1,-1,-1,-1,-1],[0,3,4,-1,0,4,9,-1,0,9,8,-1,3,9,4,-1,5,6,0,-1],[0,3,4,-1,1,2,9,-1,0,1,9,-1,3,2,1,-1,5,6,3,-1],[1,2,3,-1,9,8,3,-1,5,6,3,-1,-1,-1,-1,-1],[1,2,4,-1,1,4,9,-1,1,9,8,-1,2,9,4,-1,5,6,1,-1],[0,3,4,-1,0,4,9,-1,0,9,8,-1,3,9,4,-1,1,2,0,-1,5,6,1,-1],[0,2,3,-1,0,3,8,-1,0,8,9,-1,2,8,3,-1,5,6,2,-1],[2,3,9,-1,8,3,9,-1,5,6,2,-1,-1,-1,-1,-1],[4,5,6,-1,4,6,7,-1,4,7,9,-1,5,7,6,-1],[0,3,4,-1,0,4,7,-1,5,6,0,-1,4,9,7,-1,3,5,0,-1,6,9,5,-1],[0,3,4,-1,0,4,7,-1,1,2,9,-1,3,1,9,-1,0,2,1,-1,5,6,3,-1,7,5,3,-1],[1,2,3,-1,4,7,3,-1,9,8,3,-1,2,4,3,-1,7,9,4,-1,5,6,2,-1],[1,2,4,-1,1,4,7,-1,1,7,9,-1,2,7,4,-1,5,6,1,-1,7,5,1,-1],[0,3,4,-1,0,4,7,-1,1,2,0,-1,3,7,4,-1,2,7,0,-1,5,6,1,-1,7,5,1,-1],[0,2,3,-1,0,3,8,-1,4,7,8,-1,3,4,8,-1,2,7,4,-1,5,6,2,-1,7,5,2,-1],[2,3,4,-1,2,4,7,-1,5,6,2,-1,4,5,2,-1,7,6,5,-1],[9,10,11,-1,8,7,6,-1,9,8,11,-1,7,6,8,-1],[0,3,9,-1,0,9,11,-1,0,11,10,-1,3,11,9,-1,8,7,6,-1],[0,1,2,-1,9,10,11,-1,1,9,0,-1,2,10,9,-1,8,7,6,-1],[1,2,3,-1,9,10,11,-1,8,7,6,-1,-1,-1,-1,-1],[1,2,4,-1,9,10,11,-1,8,7,6,-1,1,8,4,-1,2,7,8,-1,10,11,9,-1],[1,2,0,-1,4,7,0,-1,3,0,4,-1,-1,-1,-1,-1,8,9,10,-1,11,6,5,-1],[0,1,2,-1,0,2,3,-1,4,7,8,-1,9,10,11,-1,-1,-1,-1,-1],[1,2,3,-1,4,7,8,-1,9,10,11,-1,-1,-1,-1,-1],[4,5,6,-1,8,9,4,-1,5,9,4,-1,-1,-1,-1,-1],[8,9,0,-1,8,0,3,-1,8,3,4,-1,9,3,0,-1],[0,1,2,-1,8,9,5,-1,0,5,4,-1,1,5,9,-1],[1,2,3,-1,8,9,5,-1,4,3,5,-1,-1,-1,-1,-1],[1,2,6,-1,1,6,5,-1,8,9,6,-1,5,8,6,-1],[0,3,8,-1,0,8,5,-1,0,5,6,-1,3,5,8,-1],[0,1,2,-1,0,1,6,-1,0,6,5,-1,1,5,6,-1],[5,6,8,-1,3,5,8,-1,-1,-1,-1,-1,-1,-1,-1,-1],[4,5,6,-1,4,6,7,-1,8,9,7,-1,6,8,7,-1],[0,3,8,-1,5,6,3,-1,7,3,6,-1,-1,-1,-1,-1],[0,1,2,-1,4,7,5,-1,0,5,1,-1,7,5,4,-1],[1,2,3,-1,4,7,5,-1,8,3,5,-1,-1,-1,-1,-1],[1,2,6,-1,1,6,7,-1,8,9,7,-1,1,8,7,-1],[8,9,7,-1,1,8,7,-1,-1,-1,-1,-1,-1,-1,-1,-1],[0,1,2,-1,0,1,3,-1,4,7,3,-1,1,4,3,-1],[2,3,8,-1,4,7,8,-1,-1,-1,-1,-1,-1,-1,-1,-1],[9,10,11,-1,7,8,4,-1,10,8,4,-1,11,7,8,-1],[11,10,9,-1,11,9,0,-1,11,0,3,-1,9,3,0,-1,7,8,4,-1],[0,1,2,-1,9,10,11,-1,1,9,0,-1,2,10,9,-1,7,8,4,-1],[1,2,3,-1,9,10,11,-1,7,8,4,-1,-1,-1,-1,-1],[1,2,11,-1,1,11,9,-1,7,8,4,-1,2,8,11,-1,9,4,8,-1],[1,2,11,-1,1,11,9,-1,0,3,4,-1,2,3,11,-1,9,0,3,-1,7,8,4,-1],[0,1,2,-1,0,1,9,-1,0,9,11,-1,1,11,9,-1,7,8,4,-1],[1,2,3,-1,1,3,9,-1,1,9,11,-1,3,11,9,-1,7,8,4,-1],[4,5,6,-1,7,8,4,-1,9,10,11,-1,5,8,4,-1,6,7,8,-1,9,10,11,-1],[11,10,9,-1,4,5,6,-1,0,3,9,-1,5,3,9,-1,6,11,3,-1,4,0,3,-1],[0,1,2,-1,4,5,6,-1,9,10,11,-1,1,9,0,-1,2,10,9,-1,5,8,4,-1],[1,2,3,-1,4,5,6,-1,9,10,11,-1,8,7,3,-1,5,8,3,-1,6,7,5,-1],[1,2,11,-1,1,11,9,-1,4,5,6,-1,2,5,11,-1,9,4,5,-1],[1,2,11,-1,1,11,9,-1,3,0,8,-1,2,0,11,-1,9,3,0,-1,5,4,6,-1],[0,1,2,-1,0,1,9,-1,0,9,11,-1,1,11,9,-1,3,4,5,-1,6,0,3,-1],[1,2,3,-1,1,3,9,-1,1,9,11,-1,3,11,9,-1,4,5,6,-1,8,7,0,-1],[4,5,6,-1,7,8,4,-1,10,11,1,-1,5,8,4,-1,6,7,8,-1,10,11,1,-1],[4,5,6,-1,7,8,4,-1,3,0,10,-1,5,8,4,-1,6,7,8,-1,0,10,3,-1,11,1,10,-1],[0,1,2,-1,0,1,3,-1,4,5,6,-1,7,8,3,-1,5,8,3,-1,6,7,5,-1,10,11,0,-1],[1,2,3,-1,4,5,6,-1,7,8,3,-1,10,11,1,-1,-1,-1,-1]];
    
    run(data: number[], dims: [number, number, number], isolevel: number) {
        const vertices: THREE.Vector3[] = [];
        const [dimX, dimY, dimZ] = dims;

        const getVal = (x:number, y:number, z:number) => {
            if (x<0 || y<0 || z<0 || x>=dimX || y>=dimY || z>=dimZ) return 0;
            return data[x + y*dimX + z*dimX*dimY];
        }

        for (let z = 0; z < dimZ - 1; z++) {
            for (let y = 0; y < dimY - 1; y++) {
                for (let x = 0; x < dimX - 1; x++) {
                    const p: [number, number, number][] = [
                        [x, y, z], [x+1, y, z], [x+1, y+1, z], [x, y+1, z],
                        [x, y, z+1], [x+1, y, z+1], [x+1, y+1, z+1], [x, y+1, z+1]
                    ];
                    const v = p.map(pos => getVal(pos[0], pos[1], pos[2]));

                    let cubeindex = 0;
                    if (v[0] < isolevel) cubeindex |= 1;
                    if (v[1] < isolevel) cubeindex |= 2;
                    if (v[2] < isolevel) cubeindex |= 4;
                    if (v[3] < isolevel) cubeindex |= 8;
                    if (v[4] < isolevel) cubeindex |= 16;
                    if (v[5] < isolevel) cubeindex |= 32;
                    if (v[6] < isolevel) cubeindex |= 64;
                    if (v[7] < isolevel) cubeindex |= 128;

                    if (this.edgeTable[cubeindex] === 0) continue;

                    const vertlist: (THREE.Vector3 | null)[] = Array(12).fill(null);

                    if (this.edgeTable[cubeindex] & 1) vertlist[0] = this.vertexInterp(isolevel,p[0],p[1],v[0],v[1]);
                    if (this.edgeTable[cubeindex] & 2) vertlist[1] = this.vertexInterp(isolevel,p[1],p[2],v[1],v[2]);
                    if (this.edgeTable[cubeindex] & 4) vertlist[2] = this.vertexInterp(isolevel,p[2],p[3],v[2],v[3]);
                    if (this.edgeTable[cubeindex] & 8) vertlist[3] = this.vertexInterp(isolevel,p[3],p[0],v[3],v[0]);
                    if (this.edgeTable[cubeindex] & 16) vertlist[4] = this.vertexInterp(isolevel,p[4],p[5],v[4],v[5]);
                    if (this.edgeTable[cubeindex] & 32) vertlist[5] = this.vertexInterp(isolevel,p[5],p[6],v[5],v[6]);
                    if (this.edgeTable[cubeindex] & 64) vertlist[6] = this.vertexInterp(isolevel,p[6],p[7],v[6],v[7]);
                    if (this.edgeTable[cubeindex] & 128) vertlist[7] = this.vertexInterp(isolevel,p[7],p[4],v[7],v[4]);
                    if (this.edgeTable[cubeindex] & 256) vertlist[8] = this.vertexInterp(isolevel,p[0],p[4],v[0],v[4]);
                    if (this.edgeTable[cubeindex] & 512) vertlist[9] = this.vertexInterp(isolevel,p[1],p[5],v[1],v[5]);
                    if (this.edgeTable[cubeindex] & 1024) vertlist[10] = this.vertexInterp(isolevel,p[2],p[6],v[2],v[6]);
                    if (this.edgeTable[cubeindex] & 2048) vertlist[11] = this.vertexInterp(isolevel,p[3],p[7],v[3],v[7]);

                    for (let i = 0; this.triTable[cubeindex][i] !== -1; i += 3) {
                        const v1 = vertlist[this.triTable[cubeindex][i+2]];
                        const v2 = vertlist[this.triTable[cubeindex][i+1]];
                        const v3 = vertlist[this.triTable[cubeindex][i]];
                        if(v1 && v2 && v3) {
                            vertices.push(v1, v2, v3);
                        }
                    }
                }
            }
        }
        return vertices;
    }

    private vertexInterp(isolevel: number, p1: number[], p2: number[], valp1: number, valp2: number): THREE.Vector3 {
        // This function is a critical point for stability. Intermittent rendering failures
        // occur when floating-point inaccuracies lead to division by zero, creating
        // NaN or Infinity values that crash the WebGL renderer. This implementation
        // adds robust checks to prevent that.
        const diff = valp2 - valp1;

        if (Math.abs(diff) < 1e-9) {
            // When the values are nearly identical, interpolation is unsafe.
            // We return an endpoint to avoid generating invalid geometry.
            return new THREE.Vector3(p1[0], p1[1], p1[2]);
        }

        const mu = (isolevel - valp1) / diff;
        
        const x = p1[0] + mu * (p2[0] - p1[0]);
        const y = p1[1] + mu * (p2[1] - p1[1]);
        const z = p1[2] + mu * (p2[2] - p1[2]);
        
        // A final check to guarantee we don't pass invalid data to the renderer.
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          return new THREE.Vector3(p1[0], p1[1], p1[2]); // Failsafe
        }

        return new THREE.Vector3(x, y, z);
    }
})();

class ThreeDManager {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;
    private labelRenderer: CSS2DRenderer;
    private animationFrameId: number | null = null;
    private pipeLabels: { label: CSS2DObject, pipeCenter: THREE.Vector3, pipeDirection: THREE.Vector3, pipeRadius: number }[] = [];
    private pipeObjects: THREE.Object3D[] = [];
    private isoSurfaceObjects: THREE.Mesh[] = [];
    private soilLayerObjects: THREE.Object3D[] = [];

    constructor(private canvasElement: HTMLCanvasElement) {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1e1e1e);

        this.camera = new THREE.PerspectiveCamera(75, canvasElement.width / canvasElement.height, 0.1, 5000);
        this.camera.position.set(0, 10, 20);

        this.renderer = new THREE.WebGLRenderer({ canvas: canvasElement, antialias: true });
        this.renderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight, false);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        canvasElement.parentElement!.appendChild(this.labelRenderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 7.5);
        this.scene.add(directionalLight);

        window.addEventListener('resize', this.onWindowResize.bind(this));
    }

    private onWindowResize() {
        const canvas = this.renderer.domElement;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        if (canvas.width !== width || canvas.height !== height) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();

            this.renderer.setSize(width, height, false);
            this.labelRenderer.setSize(width, height);
        }
    }

    buildScene(sceneData: SceneData, isoSurfacesData: IsoSurface[]) {
        // Clear previous objects
        this.pipeObjects.forEach(obj => this.scene.remove(obj));
        this.pipeObjects = [];
        this.pipeLabels.forEach(l => {
            l.label.element.remove();
            this.scene.remove(l.label);
        });
        this.pipeLabels = [];
        this.isoSurfaceObjects.forEach(obj => this.scene.remove(obj));
        this.isoSurfaceObjects = [];
        this.soilLayerObjects.forEach(obj => this.scene.remove(obj));
        this.soilLayerObjects = [];
        
        // Soil Layers
        const worldBoxWidth = sceneData.worldWidth;
        const worldBoxDepth = sceneData.worldDepth;
        const worldCenterX = sceneData.worldMinX + sceneData.worldWidth / 2;
        const worldCenterZ_3D = sceneData.worldMinY + sceneData.worldDepth / 2;

        sceneData.layers.forEach(layer => {
            const layerHeight = layer.thickness;
            const layerY = -(layer.depth_top + layerHeight / 2); // Y is vertical in 3D, and negative for depth

            const layerGeo = new THREE.BoxGeometry(worldBoxWidth, layerHeight, worldBoxDepth);
            
            // Color based on conductivity. Normalize k from a reasonable range (e.g., 0.2 to 3.0)
            const kMin = 0.2, kMax = 3.0;
            const kRatio = Math.max(0, Math.min(1, (layer.k - kMin) / (kMax - kMin)));
            // We'll go from a light brown (low k) to a dark brown (high k)
            const color = new THREE.Color().setHSL(0.08, 0.5, 0.6 - 0.4 * kRatio);

            const layerMat = new THREE.MeshStandardMaterial({
                color: color,
                opacity: 0.2,
                transparent: true,
                side: THREE.DoubleSide,
                roughness: 0.9,
            });

            const layerMesh = new THREE.Mesh(layerGeo, layerMat);
            layerMesh.position.set(worldCenterX, layerY, worldCenterZ_3D);
            this.scene.add(layerMesh);
            this.soilLayerObjects.push(layerMesh);
            
            const edges = new THREE.EdgesGeometry(layerGeo);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.2, transparent: true }));
            line.position.copy(layerMesh.position);
            this.scene.add(line);
            this.soilLayerObjects.push(line);
        });
        
        // Pipes
        const pipeLength = Math.max(sceneData.worldWidth, sceneData.worldDepth, 20) * 2;
        sceneData.pipes.forEach(pipe => {
            const pipeGroup = new THREE.Group();
            
            // Outer pipe (steel)
            const pipeGeo = new THREE.CylinderGeometry(pipe.r_pipe, pipe.r_pipe, pipeLength, 32);
            const pipeMat = new THREE.MeshStandardMaterial({ 
                color: new THREE.Color(getTemperatureColor(pipe.temp, sceneData.minTemp, sceneData.maxTemp)),
                roughness: 0.4,
                metalness: 0.8
            });
            const pipeMesh = new THREE.Mesh(pipeGeo, pipeMat);
            pipeGroup.add(pipeMesh);

            // Insulation
            if (pipe.r_ins > pipe.r_pipe) {
                const insGeo = new THREE.CylinderGeometry(pipe.r_ins, pipe.r_ins, pipeLength, 32);
                const insMat = new THREE.MeshStandardMaterial({ 
                    color: 0xcccccc, 
                    roughness: 0.9,
                    transparent: true,
                    opacity: 0.2
                });
                const insMesh = new THREE.Mesh(insGeo, insMat);
                pipeGroup.add(insMesh);
            }
            
            // Bedding
            if (pipe.r_bed > pipe.r_ins) {
                 const bedGeo = new THREE.CylinderGeometry(pipe.r_bed, pipe.r_bed, pipeLength, 32);
                 const bedMat = new THREE.MeshStandardMaterial({ 
                    color: 0x8B4513, // SaddleBrown
                    roughness: 0.9,
                    transparent: true,
                    opacity: 0.15
                });
                const bedMesh = new THREE.Mesh(bedGeo, bedMat);
                pipeGroup.add(bedMesh);
            }

            let pipeCenter: THREE.Vector3;
            let pipeDirection: THREE.Vector3;

            if (pipe.orientation === 'parallel') {
                pipeGroup.position.set(pipe.x, -pipe.z, 0);
                pipeGroup.rotation.x = Math.PI / 2;
                 pipeCenter = new THREE.Vector3(pipe.x, -pipe.z, 0);
                 pipeDirection = new THREE.Vector3(0, 0, 1);
            } else { // perpendicular
                pipeGroup.position.set(0, -pipe.z, pipe.y);
                pipeGroup.rotation.z = Math.PI / 2;
                pipeCenter = new THREE.Vector3(0, -pipe.z, pipe.y);
                pipeDirection = new THREE.Vector3(1, 0, 0);
            }

            this.scene.add(pipeGroup);
            this.pipeObjects.push(pipeGroup);

            // Pipe Label
            const labelDiv = document.createElement('div');
            labelDiv.className = 'pipe-label';
            const displayTemp = CONVERSIONS.CtoF(pipe.temp);
            labelDiv.textContent = `${pipe.name} (${displayTemp.toFixed(1)} ${UNIT_SYSTEMS.imperial.temp})`;
            const label = new CSS2DObject(labelDiv);
            this.scene.add(label);
            this.pipeLabels.push({ label, pipeCenter, pipeDirection, pipeRadius: pipe.r_bed });
        });

        this.updateLabels();

        // Isosurfaces
        const activeIsoSurfaces = isoSurfacesData.filter(iso => iso.enabled);
        if (activeIsoSurfaces.length > 0) {
            const gridSize = 40;
            const dims: [number, number, number] = [gridSize, gridSize, gridSize];
            const [dimX, dimY, dimZ] = dims;
            const scalarField = new Float32Array(dimX * dimY * dimZ);
            
            const worldBox = new THREE.Box3(
                new THREE.Vector3(sceneData.worldMinX, -sceneData.worldHeight, sceneData.worldMinY),
                new THREE.Vector3(sceneData.worldMinX + sceneData.worldWidth, 0, sceneData.worldMinY + sceneData.worldDepth)
            );

            for (let i = 0; i < dimX; i++) {
                for (let j = 0; j < dimY; j++) {
                    for (let k = 0; k < dimZ; k++) {
                        const worldX = worldBox.min.x + (i / (dimX - 1)) * (worldBox.max.x - worldBox.min.x);
                        const worldZ = worldBox.min.z + (k / (dimZ - 1)) * (worldBox.max.z - worldBox.min.z);
                        // Y in three.js is Z in our physics calc, and it's negative
                        const worldY_Physics = -(worldBox.min.y + (j / (dimY - 1)) * (worldBox.max.y - worldBox.min.y));
                        
                        const temp = calculateTemperatureAtPoint(worldX, worldY_Physics, sceneData);
                        scalarField[i + j * dimX + k * dimX * dimY] = temp;
                    }
                }
            }

            activeIsoSurfaces.forEach(iso => {
                const tempC = CONVERSIONS.FtoC(iso.temp);
                const vertices = marchingCubes.run(scalarField as any, dims, tempC);
                
                if (vertices.length > 0) {
                    const geometry = new THREE.BufferGeometry();
                    const positions = new Float32Array(vertices.length * 3);
                    vertices.forEach((v, index) => {
                       // Scale vertex back to world coordinates
                       positions[index * 3] = worldBox.min.x + (v.x / (dimX - 1)) * (worldBox.max.x - worldBox.min.x);
                       positions[index * 3 + 1] = worldBox.min.y + (v.y / (dimY - 1)) * (worldBox.max.y - worldBox.min.y);
                       positions[index * 3 + 2] = worldBox.min.z + (v.z / (dimZ - 1)) * (worldBox.max.z - worldBox.min.z);
                    });

                    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                    geometry.computeVertexNormals();
                    
                    const material = new THREE.MeshStandardMaterial({
                        color: new THREE.Color(iso.color),
                        opacity: iso.opacity,
                        transparent: true,
                        side: THREE.DoubleSide,
                        roughness: 0.7
                    });
                    
                    const mesh = new THREE.Mesh(geometry, material);
                    this.scene.add(mesh);
                    this.isoSurfaceObjects.push(mesh);
                }
            });
        }
        
        // Adjust camera to fit the scene's scope
        const box = new THREE.Box3();

        // Define the bounding box based on the semantic dimensions of the scene data,
        // not the geometry of the infinitely long pipes. This is the key to correct framing.
        // Physics Z (depth) maps to negative Three.js Y.
        // Physics Y (perpendicular) maps to Three.js Z.
        box.set(
            new THREE.Vector3(sceneData.worldMinX, -sceneData.worldHeight, sceneData.worldMinY),
            new THREE.Vector3(
                sceneData.worldMinX + sceneData.worldWidth, 
                0, // Ground level
                sceneData.worldMinY + sceneData.worldDepth
            )
        );

        // Also ensure any generated isosurfaces are visible
        this.isoSurfaceObjects.forEach(obj => box.expandByObject(obj));
        
        // Handle case where box is empty or invalid (e.g., first run with no data)
        if (box.isEmpty() || !Number.isFinite(box.min.lengthSq()) || !Number.isFinite(box.max.lengthSq())) {
            box.setFromCenterAndSize(new THREE.Vector3(0, -5, 0), new THREE.Vector3(20, 10, 20));
        }

        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);

        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        const distance = (maxDim / 2) / Math.tan(fov / 2);

        // Position the camera away from the center of the bounding box for a nice view
        const cameraOffset = new THREE.Vector3(0.5, 0.4, 1).normalize().multiplyScalar(distance * 1.5);
        this.camera.position.copy(center).add(cameraOffset);

        this.controls.target.copy(center);
        this.controls.update();
    }
    
    private updateLabels() {
        this.pipeLabels.forEach(labelInfo => {
            const { label, pipeCenter, pipeDirection } = labelInfo;
            const cameraPosition = this.camera.position;
            
            // Find the point on the infinite line of the pipe that is closest to the camera
            const line = new THREE.Line3(
                pipeCenter.clone().addScaledVector(pipeDirection, -1000),
                pipeCenter.clone().addScaledVector(pipeDirection, 1000)
            );
            const closestPointOnLine = new THREE.Vector3();
            line.closestPointToPoint(cameraPosition, true, closestPointOnLine);

            // Position the label slightly above this closest point, offset towards the camera
            const offsetDirection = cameraPosition.clone().sub(closestPointOnLine).normalize();
            // Project offset to be perpendicular to pipe direction to avoid moving along the pipe
            const componentAlongPipe = offsetDirection.dot(pipeDirection);
            offsetDirection.sub(pipeDirection.clone().multiplyScalar(componentAlongPipe));

            label.position.copy(closestPointOnLine).addScaledVector(offsetDirection, labelInfo.pipeRadius + 0.5);
        });
    }

    stopAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    startAnimation() {
        if (this.animationFrameId === null) {
            this.animate();
        }
    }

    private animate() {
        this.animationFrameId = requestAnimationFrame(this.animate.bind(this));
        
        this.controls.update();
        this.updateLabels();
        
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }
}


// --- Material Library Management ---
function loadCustomMaterials(): CustomMaterial[] {
    try {
        const stored = localStorage.getItem(MATERIAL_STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error("Failed to load custom materials:", e);
        return [];
    }
}

function saveCustomMaterials() {
    try {
        localStorage.setItem(MATERIAL_STORAGE_KEY, JSON.stringify(customMaterials));
    } catch (e) {
        console.error("Failed to save custom materials:", e);
    }
}

function addCustomMaterial(type: MaterialType, name: string, kValueRaw: number) {
    const kValueWmk = CONVERSIONS.btuHrFtFtoWMK(kValueRaw);

    if (!name || isNaN(kValueWmk) || kValueWmk < 0) {
        alert('Invalid material name or k-value.');
        return;
    }

    customMaterials.push({ id: `custom-${Date.now()}-${Math.random()}`, type, name, k: kValueWmk });
    saveCustomMaterials();
    renderMaterialLibrary();
    populateAllMaterialSelects();
}

function removeCustomMaterial(id: string) {
    customMaterials = customMaterials.filter(m => m.id !== id);
    saveCustomMaterials();
    renderMaterialLibrary();
    populateAllMaterialSelects();
}

function setupMaterialForms() {
    const forms: {formId: string, type: MaterialType}[] = [
        { formId: 'add-soil-material-form', type: 'soil' },
        { formId: 'add-pipe-material-form', type: 'pipe' },
        { formId: 'add-insulation-material-form', type: 'insulation' },
        { formId: 'add-bedding-material-form', type: 'bedding' },
    ];

    forms.forEach(({formId, type}) => {
        const form = document.getElementById(formId) as HTMLFormElement;
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const nameInput = form.querySelector('input[type="text"]') as HTMLInputElement;
            const kInput = form.querySelector('input[type="number"]') as HTMLInputElement;
            addCustomMaterial(type, nameInput.value, parseFloat(kInput.value));
            form.reset();
        });
    });
}

function renderMaterialLibrary() {
    const tables: {tableId: string, type: MaterialType}[] = [
        { tableId: 'soil-material-table', type: 'soil' },
        { tableId: 'pipe-material-table', type: 'pipe' },
        { tableId: 'insulation-material-table', type: 'insulation' },
        { tableId: 'bedding-material-table', type: 'bedding' },
    ];

    tables.forEach(({tableId, type}) => {
        const tableBody = document.querySelector(`#${tableId} tbody`) as HTMLTableSectionElement;
        tableBody.innerHTML = '';
        customMaterials.filter(m => m.type === type).forEach(mat => {
            const row = document.createElement('tr');
            const kValueDisplay = CONVERSIONS.wmkToBtuHrFtF(mat.k);
            
            row.innerHTML = `
                <td>${mat.name}</td>
                <td>${kValueDisplay.toFixed(3)}</td>
                <td><button class="remove-btn" title="Remove Material">&times;</button></td>
            `;
            row.querySelector('.remove-btn')?.addEventListener('click', () => removeCustomMaterial(mat.id));
            tableBody.appendChild(row);
        });
    });
}

function populateMaterialSelect(select: HTMLSelectElement, type: MaterialType) {
    select.innerHTML = '';
    
    // Add presets
    const presets = MATERIAL_PRESETS[type as keyof typeof MATERIAL_PRESETS] || [];
    presets.forEach(p => {
        const option = document.createElement('option');
        option.value = p.k.toString();
        
        const kValueDisplay = CONVERSIONS.wmkToBtuHrFtF(p.k);
        let kString = p.k > 0 ? `(k=${kValueDisplay.toFixed(2)})` : '';
        if(p.name.toLowerCase().includes('none') || p.name.toLowerCase().includes('insulation')) {
           kString = '';
        }
        option.textContent = `${p.name} ${kString}`;
        select.appendChild(option);
    });

    // Add separator if custom materials exist
    const customForType = customMaterials.filter(m => m.type === type);
    if (customForType.length > 0) {
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '--- Custom ---';
        select.appendChild(separator);
    }
    
    // Add custom materials
    customForType.forEach(mat => {
        const option = document.createElement('option');
        option.value = mat.k.toString();
        const kValueDisplay = CONVERSIONS.wmkToBtuHrFtF(mat.k);
        option.textContent = `${mat.name} (k=${kValueDisplay.toFixed(2)})`;
        select.appendChild(option);
    });
}

function populateAllMaterialSelects() {
    document.querySelectorAll('.soil-layer-material-select').forEach(el => populateMaterialSelect(el as HTMLSelectElement, 'soil'));
    document.querySelectorAll('.pipe-material-select').forEach(el => populateMaterialSelect(el as HTMLSelectElement, 'pipe'));
    document.querySelectorAll('.pipe-insulation-material-select').forEach(el => populateMaterialSelect(el as HTMLSelectElement, 'insulation'));
    document.querySelectorAll('.pipe-bedding-material-select').forEach(el => populateMaterialSelect(el as HTMLSelectElement, 'bedding'));
}


// --- Event Handlers & Main Logic ---

function handleCalculate() {
    errorContainer.style.display = 'none';
    errorContainer.textContent = '';
    
    let hasErrors = false;
    document.querySelectorAll('.pipe-row').forEach(row => {
        if (!validatePipeRow(row as HTMLElement)) {
            hasErrors = true;
        }
    });
    if (hasErrors) {
        errorContainer.textContent = 'Please fix the errors in the pipe configurations before calculating.';
        errorContainer.style.display = 'block';
        return;
    }

    try {
        const systemDefaults = UNIT_SYSTEMS.imperial.defaults;
        const rawSoilTemp = parseFloat(soilTempInput.value) || systemDefaults.temp;
        const T_soil_C = CONVERSIONS.FtoC(rawSoilTemp);

        const pipes = getPipes();
        const soilLayers = getSoilLayers();
        if (soilLayers.length === 0) {
           errorContainer.textContent = 'At least one soil layer must be defined.';
           errorContainer.style.display = 'block';
           return;
        }

        currentCalculationData = calculateTemperatures(pipes, soilLayers, T_soil_C);

        renderResultsTable(currentCalculationData.results);
        updateView();
        
        outputWrapper.style.display = 'flex';
        visualizationOptions.style.display = 'flex';

    } catch (e) {
        console.error("Calculation failed:", e);
        errorContainer.textContent = e instanceof Error ? e.message : 'An unexpected error occurred during calculation.';
        errorContainer.style.display = 'block';
        outputWrapper.style.display = 'flex';
        visualizationOptions.style.display = 'none';
    }
}

function updateView() {
    if (!currentCalculationData) return;
    const mode = (document.querySelector('input[name="view-mode"]:checked') as HTMLInputElement).value as ViewMode;
    currentViewMode = mode;
    
    canvas.style.display = mode === '2d' ? 'block' : 'none';
    webglCanvas.style.display = mode === '3d' ? 'block' : 'none';
    
    visToggles.style.display = mode === '2d' ? 'flex' : 'none';
    isothermControls.classList.toggle('active', mode === '2d');
    isosurfaceControls.classList.toggle('active', mode === '3d');

    if (mode === '2d') {
        threeDManager?.stopAnimation();
        draw2DScene(currentCalculationData.sceneData);
    } else { // 3D
        if (!threeDManager) {
            threeDManager = new ThreeDManager(webglCanvas);
        }
        threeDManager.buildScene(currentCalculationData.sceneData, isoSurfaces);
        threeDManager.startAnimation();
    }
}

function renderResultsTable(results: {pipeId: number, pipeName: string, finalTemp: number}[]) {
    const tempUnit = UNIT_SYSTEMS.imperial.temp;
    let tableHtml = `
        <table>
            <thead>
                <tr>
                    <th>Pipe</th>
                    <th>Final Temperature (${tempUnit})</th>
                </tr>
            </thead>
            <tbody>`;

    results.forEach(result => {
        const displayTemp = CONVERSIONS.CtoF(result.finalTemp);
        tableHtml += `
            <tr>
                <td class="pipe-id-cell">${result.pipeName}</td>
                <td class="temp-cell">${displayTemp.toFixed(1)}</td>
            </tr>`;
    });
    
    tableHtml += `</tbody></table>`;
    resultsTableContainer.innerHTML = tableHtml;
}

function loadExample() {
    resetToDefaults();
    
    // Imperial Example
    // Project Info
    projectNameInput.value = "Downtown Steam Crossing";
    projectLocationInput.value = "Springfield";
    systemNumberInput.value = "SYS-12345-A";
    engineerNameInput.value = "Jane Doe, P.Eng.";
    evalDateInput.valueAsDate = new Date();
    revisionNumberInput.value = "1";
    projectDescriptionInput.value = "Verification of temperature on existing gas main due to new adjacent steam line installation.";

    // Environment
    soilTempInput.value = "60";
    addSoilLayer({ k: 1.5, thickness: CONVERSIONS.ftToM(10) }); // Moist Soil
    addSoilLayer({ k: 2.5, thickness: CONVERSIONS.ftToM(20) }); // Saturated Soil

    // Pipes
    addPipe({
        name: 'New Steam Line', role: 'heat_source', orientation: 'parallel',
        x: CONVERSIONS.ftToM(-3), y: 0, z: CONVERSIONS.ftToM(5),
        temp: CONVERSIONS.FtoC(450), od: CONVERSIONS.inToM(12.75),
        thickness: CONVERSIONS.inToM(0.406), k_pipe: 54,
        ins_thickness: CONVERSIONS.inToM(2), k_ins: 0.05,
        bed_thickness: CONVERSIONS.inToM(6), k_bedding: 0.27
    });
    addPipe({
        name: 'Existing Gas Main', role: 'affected_pipe', orientation: 'parallel',
        x: CONVERSIONS.ftToM(3), y: 0, z: CONVERSIONS.ftToM(4),
        od: CONVERSIONS.inToM(8.625), thickness: CONVERSIONS.inToM(0.322),
        k_pipe: 54, ins_thickness: 0, k_ins: 0,
        bed_thickness: CONVERSIONS.inToM(6), k_bedding: 0.27
    });
     addPipe({
        name: 'Crossing Water Line', role: 'affected_pipe', orientation: 'perpendicular',
        x: 0, y: CONVERSIONS.ftToM(10), z: CONVERSIONS.ftToM(6),
        od: CONVERSIONS.inToM(6.625), thickness: CONVERSIONS.inToM(0.280),
        k_pipe: 54, ins_thickness: 0, k_ins: 0,
        bed_thickness: 0, k_bedding: 0
    });

    addIsotherm({temp: 85, color: '#ffdd00'});
    addIsoSurface({temp: 85, color: '#ffdd00', opacity: 0.3});

    handleCalculate();
    
    // Switch to calculator tab if not already there
    document.querySelector('.tab-link[data-tab="calculator"]')?.dispatchEvent(new MouseEvent('click'));
}

function resetToDefaults() {
    // Clear dynamic lists
    pipeList.innerHTML = '';
    soilLayersList.innerHTML = '';
    isothermList.innerHTML = '';
    isosurfaceList.innerHTML = '';
    
    pipeIdCounter = 0;
    isothermIdCounter = 0;
    isoSurfaceIdCounter = 0;

    isotherms = [];
    isoSurfaces = [];
    
    // Reset forms
    const calculatorForm = document.getElementById('calculator-container')?.closest('form') as HTMLFormElement | null;
    if(calculatorForm) calculatorForm.reset();

    projectNameInput.value = "";
    projectLocationInput.value = "";
    systemNumberInput.value = "";
    engineerNameInput.value = "";
    evalDateInput.value = "";
    revisionNumberInput.value = "1";
    projectDescriptionInput.value = "";

    // Reset state
    outputWrapper.style.display = 'none';
    currentCalculationData = null;
    updateUnitsUI(); // This will set default soil temp based on units
    threeDManager?.stopAnimation();
}

function saveScenario() {
    if (!currentCalculationData) {
        alert("Please run a calculation before saving.");
        return;
    }
    const scenario = {
        projectInfo: getProjectInfo(),
        unitSystem: 'imperial',
        soilTemp: parseFloat(soilTempInput.value),
        soilLayers: getSoilLayers().map(l => ({ k: l.k, thickness: l.thickness })),
        pipes: getPipes().map(p => ({
            name: p.name,
            role: p.role,
            orientation: p.orientation,
            x: p.x, y: p.y, z: p.z,
            temp: p.temp,
            od: p.od, thickness: p.thickness, k_pipe: p.k_pipe,
            ins_thickness: p.ins_thickness, k_ins: p.k_ins,
            bed_thickness: p.bed_thickness, k_bedding: p.k_bedding,
        })),
        isotherms,
        isoSurfaces,
        showFluxVectors
    };
    
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = scenario.projectInfo.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'scenario';
    a.href = url;
    a.download = `${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function loadScenarioFromFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const scenario = JSON.parse(e.target?.result as string);
            applyScenario(scenario);
        } catch (error) {
            console.error("Error parsing scenario file:", error);
            alert("Could not load scenario. The file may be corrupt or invalid.");
        }
    };
    reader.readAsText(file);
}

function applyScenario(scenario: any) {
    resetToDefaults();
    
    updateUnitsUI();
    
    // Project Info
    const proj = scenario.projectInfo;
    projectNameInput.value = proj.name || '';
    projectLocationInput.value = proj.location || '';
    systemNumberInput.value = proj.system || '';
    engineerNameInput.value = proj.engineer || '';
    evalDateInput.value = proj.date || '';
    revisionNumberInput.value = proj.revision || '1';
    projectDescriptionInput.value = proj.description || '';
    
    soilTempInput.value = scenario.soilTemp.toString();
    
    scenario.soilLayers.forEach((l: any) => addSoilLayer(l));
    scenario.pipes.forEach((p: any) => addPipe(p));
    
    (scenario.isotherms || []).forEach((iso: any) => addIsotherm(iso));
    (scenario.isoSurfaces || []).forEach((surf: any) => addIsoSurface(surf));
    
    toggleFluxVectors.checked = scenario.showFluxVectors || false;
    showFluxVectors = toggleFluxVectors.checked;

    handleCalculate();
}

function copyLatexToClipboard() {
  if (!currentCalculationData) {
    alert("Please run a calculation first.");
    return;
  }
  navigator.clipboard.writeText(currentCalculationData.latex).then(() => {
    copyBtnText.textContent = 'Copied!';
    setTimeout(() => {
      copyBtnText.textContent = 'Copy LaTeX Report';
    }, 2000);
  }, (err) => {
    console.error('Could not copy text: ', err);
    alert('Failed to copy report.');
  });
}

function sanitizeLatex(text: string): string {
    if (!text) return '';
    return text.replace(/([#$&%_{}])/g, '\\$1').replace(/\\/g, '\\textbackslash{}');
}

function generateLatexReport(
    projectInfo: ProjectInfo,
    inputs: { pipes: Pipe[]; soilLayers: SoilLayer[]; T_soil: number },
    results: { pipeId: number; pipeName: string; finalTemp: number }[],
    detailedCalcs: DetailedCalculations
): string {
    const { pipes, soilLayers, T_soil } = inputs;
    const isImperial = true;

    const header = `\\documentclass[11pt]{article}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage{geometry}
\\usepackage{booktabs}
\\usepackage{hyperref}
\\usepackage[T1]{fontenc}
\\geometry{a4paper, margin=1in}

\\title{Pipeline Heat Transfer Analysis Report\\\\ \\large ${sanitizeLatex(projectInfo.name)}}
\\author{${sanitizeLatex(projectInfo.engineer)}}
\\date{${sanitizeLatex(projectInfo.date)}}

\\begin{document}
\\maketitle
\\thispagestyle{empty}
\\newpage
\\tableofcontents
\\newpage

\\section{Project Summary}
\\begin{tabular}{@{}ll}
    \\textbf{Project Name:} & ${sanitizeLatex(projectInfo.name)} \\\\
    \\textbf{Location:} & ${sanitizeLatex(projectInfo.location)} \\\\
    \\textbf{System Number:} & ${sanitizeLatex(projectInfo.system)} \\\\
    \\textbf{Engineer:} & ${sanitizeLatex(projectInfo.engineer)} \\\\
    \\textbf{Date:} & ${sanitizeLatex(projectInfo.date)} \\\\
    \\textbf{Revision:} & ${sanitizeLatex(projectInfo.revision)} \\\\
\\end{tabular}

\\subsection*{Description}
${sanitizeLatex(projectInfo.description)}

\\section{Methodology}
This analysis calculates the steady-state temperature of buried pipelines subjected to heat transfer from adjacent heat source pipelines and the surrounding soil. The calculation is based on the principle of superposition and the method of images to model the ground surface as an adiabatic (no heat flow) boundary.

The heat flux, \\(Q\\) (W/m), from a source pipe is determined by modeling the system as a network of thermal resistances:
\\begin{equation}
    Q = \\frac{\\Delta T}{R_{total}} = \\frac{T_{pipe} - T_{soil}}{R_{pipe} + R_{ins} + R_{bed} + R_{soil}}
\\end{equation}
Where \\(R\\) represents the thermal resistance per unit length (K·m/W) for the pipe wall, insulation, bedding, and the surrounding soil, respectively.

The temperature rise, \\(\\Delta T_{rise}\\), at a specific point caused by a line heat source \\(Q\\) is calculated using:
\\begin{equation}
    \\Delta T_{rise} = \\frac{Q}{2 \\pi k_{eff}} \\ln\\left(\\frac{d_{image}}{d_{real}}\\right)
\\end{equation}
Where \\(k_{eff}\\) is the effective thermal conductivity of the path, \\(d_{real}\\) is the distance from the source center to the point, and \\(d_{image}\\) is the distance from the mirrored "image" source (reflected across the ground plane) to the point.

The final temperature of an affected pipe is the sum of the ambient soil temperature and the cumulative temperature rises from all heat sources.

\\section{Input Parameters}
\\subsection{Ambient Conditions}
Ambient Soil Temperature, \\(T_{soil}\\): ${T_soil.toFixed(2)}~^\\circ C (${CONVERSIONS.CtoF(T_soil).toFixed(2)}~^\\circ F)\\\\

\\subsection{Soil Layer Properties}
\\begin{table}[h!]
\\centering
\\begin{tabular}{lrrrr}
\\toprule
\\textbf{Depth Top} & \\textbf{Depth Bottom} & \\textbf{Thickness} & \\multicolumn{2}{c}{\\textbf{Thermal Conductivity (k)}} \\\\
\\cmidrule(lr){4-5}
 & & & \\textbf{(W/m-K)} & \\textbf{(BTU/hr-ft-F)} \\\\
\\midrule
`;

    let soilTable = soilLayers.map(l => {
        const dTop = `${l.depth_top.toFixed(2)}~m (${CONVERSIONS.mToFt(l.depth_top).toFixed(2)}~ft)`;
        const dBot = `${l.depth_bottom.toFixed(2)}~m (${CONVERSIONS.mToFt(l.depth_bottom).toFixed(2)}~ft)`;
        const thick = `${l.thickness.toFixed(2)}~m (${CONVERSIONS.mToFt(l.thickness).toFixed(2)}~ft)`;
        const k_si = l.k.toFixed(3);
        const k_imp = ` & ${CONVERSIONS.wmkToBtuHrFtF(l.k).toFixed(3)}`;
        return `${dTop} & ${dBot} & ${thick} & ${k_si}${k_imp} \\\\`;
    }).join('\n');

    let pipeTable = `\\subsection{Pipeline Configuration}
\\begin{table}[h!]
\\centering
\\resizebox{\\textwidth}{!}{%
\\begin{tabular}{lcccccccc}
\\toprule
\\textbf{Pipe Name} & \\textbf{Role} & \\textbf{X (m)} & \\textbf{Y (m)} & \\textbf{Z (m)} & \\textbf{OD (mm)} & \\textbf{Temp (C)} & \\textbf{k\\textsubscript{pipe}} & \\textbf{k\\textsubscript{ins}} \\\\
\\midrule
`;
    pipeTable += pipes.map(p => {
        const tempStr = p.role === 'heat_source' ? p.temp!.toFixed(2) : 'N/A';
        return `${sanitizeLatex(p.name)} & ${sanitizeLatex(p.role.replace('_',' '))} & ${p.x.toFixed(2)} & ${p.y.toFixed(2)} & ${p.z.toFixed(2)} & ${(p.od*1000).toFixed(2)} & ${tempStr} & ${p.k_pipe.toFixed(2)} & ${p.k_ins.toFixed(2)} \\\\`;
    }).join('\n');
    pipeTable += `\\bottomrule
\\end{tabular}
}
\\caption{All coordinates are SI units. X/Y/Z are horizontal, perpendicular, and depth coordinates, respectively.}
\\end{table}
`;
    
    let sourceCalcs = `\\section{Heat Source Calculations}`;
    detailedCalcs.sources.forEach(s => {
        const p = pipes.find(pipe => pipe.id === s.pipeId)!;
        sourceCalcs += `
\\subsection{Source: ${sanitizeLatex(s.pipeName)}}
\\subsubsection{Thermal Resistances}
\\begin{itemize}
    \\item Pipe Wall Resistance, \\(R_{pipe}\\):
    \\begin{equation*}
        R_{pipe} = \\frac{\\ln(OD / ID)}{2 \\pi k_{pipe}} = \\frac{\\ln(${((p.od/2)*1000).toFixed(2)} / ${((p.od/2 - p.thickness)*1000).toFixed(2)})}{2 \\pi \\times ${p.k_pipe.toFixed(2)}} = ${s.R_pipe.toExponential(3)} \\text{ K·m/W}
    \\end{equation*}
    \\item Insulation Resistance, \\(R_{ins}\\):
    \\begin{equation*}
        R_{ins} = \\frac{\\ln(r_{ins, outer} / r_{pipe, outer})}{2 \\pi k_{ins}} = \\frac{\\ln(${((p.od/2 + p.ins_thickness)*1000).toFixed(2)} / ${((p.od/2)*1000).toFixed(2)})}{2 \\pi \\times ${p.k_ins.toFixed(2)}} = ${s.R_ins.toExponential(3)} \\text{ K·m/W}
    \\end{equation*}
    \\item Bedding Resistance, \\(R_{bed}\\):
    \\begin{equation*}
        R_{bed} = \\frac{\\ln(r_{bed, outer} / r_{ins, outer})}{2 \\pi k_{bed}} = \\frac{\\ln(${((p.od/2 + p.ins_thickness + p.bed_thickness)*1000).toFixed(2)} / ${((p.od/2 + p.ins_thickness)*1000).toFixed(2)})}{2 \\pi \\times ${p.k_bedding.toFixed(2)}} = ${s.R_bed.toExponential(3)} \\text{ K·m/W}
    \\end{equation*}
    \\item Soil Resistance, \\(R_{soil}\\):
    \\begin{equation*}
         R_{soil} = \\frac{\\ln(2z / r_{bed, outer})}{2 \\pi k_{soil,eff}} = \\frac{\\ln(2 \\times ${p.z.toFixed(2)} / ${(p.od/2+p.ins_thickness+p.bed_thickness).toFixed(3)})}{2 \\pi \\times ${getEffectiveSoilKForPipe(p, soilLayers).toFixed(2)}} = ${s.R_soil.toExponential(3)} \\text{ K·m/W}
    \\end{equation*}
\\end{itemize}
Total Resistance, \\(R_{total} = R_{pipe} + R_{ins} + R_{bed} + R_{soil} = ${s.R_total.toExponential(3)}\\) K·m/W.

\\subsubsection{Heat Flux Calculation}
\\begin{equation*}
    Q = \\frac{T_{pipe} - T_{soil}}{R_{total}} = \\frac{${p.temp!.toFixed(2)} - ${T_soil.toFixed(2)}}{${s.R_total.toExponential(3)}} = \\mathbf{${s.Q.toFixed(2)} \\text{ W/m}}
\\end{equation*}
`;
    });
    
    let affectedCalcs = `\\section{Affected Pipe Calculations}`;
    detailedCalcs.affectedPipes.forEach(ap => {
        affectedCalcs += `\\subsection{Pipe: ${sanitizeLatex(ap.pipeName)}}
The final temperature is calculated by summing the temperature rises from each heat source.
\\[ T_{final} = T_{soil} + \\sum \\Delta T_{rise} \\]
\\begin{itemize}
`;
        ap.interactions.forEach(i => {
            affectedCalcs += `
    \\item \\textbf{From source "${sanitizeLatex(i.sourcePipeName)}":}
    \\begin{itemize}
        \\item Real distance, \\(d_{real}\\): ${i.d_real.toFixed(3)} m
        \\item Image distance, \\(d_{image}\\): ${i.d_image.toFixed(3)} m
        \\item Effective path conductivity, \\(k_{eff}\\): ${i.k_eff_path.toFixed(3)} W/m-K
        \\item Temperature Rise:
        \\begin{equation*}
        \\Delta T = \\frac{Q}{2 \\pi k_{eff}} \\ln\\left(\\frac{d_{image}}{d_{real}}\\right) = \\frac{${(detailedCalcs.sources.find(s => s.pipeName === i.sourcePipeName)!.Q).toFixed(2)}}{2 \\pi \\times ${i.k_eff_path.toFixed(3)}} \\ln\\left(\\frac{${i.d_image.toFixed(3)}}{${i.d_real.toFixed(3)}}\\right) = ${i.tempRise.toFixed(2)}~^\\circ C
        \\end{equation*}
    \\end{itemize}
`;
        });
        affectedCalcs += `\\end{itemize}
\\textbf{Total Temperature Rise:} \\(\\sum \\Delta T_{rise} = ${ap.totalTempRise.toFixed(2)}~^\\circ C\\) \\\\
\\textbf{Final Temperature:} \\(T_{final} = ${T_soil.toFixed(2)} + ${ap.totalTempRise.toFixed(2)} = \\mathbf{${ap.finalTemp.toFixed(2)}~^\\circ C}\\) (\\(\\mathbf{${CONVERSIONS.CtoF(ap.finalTemp).toFixed(2)}~^\\circ F}\\))\\\\`;
    });

    let finalResults = `\\section{Final Results Summary}
\\begin{table}[h!]
\\centering
\\begin{tabular}{lcc}
\\toprule
\\textbf{Pipe Name} & \\textbf{Final Temperature (C)} & \\textbf{Final Temperature (F)} \\\\
\\midrule
`;
    results.forEach(r => {
        finalResults += `${sanitizeLatex(r.pipeName)} & ${r.finalTemp.toFixed(2)} & ${CONVERSIONS.CtoF(r.finalTemp).toFixed(2)} \\\\
`;
    });
    finalResults += `\\bottomrule
\\end{tabular}
\\end{table}
`;

    const footer = `\\end{document}`;

    return [header, soilTable, `\\bottomrule\n\\end{tabular}\n\\end{table}`, pipeTable, sourceCalcs, affectedCalcs, finalResults, footer].join('\n\n');
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Service Worker registration is handled in index.html

    // Event Listeners
    setupTabs();
    calculateBtn.addEventListener('click', handleCalculate);
    exampleBtn.addEventListener('click', loadExample);
    saveScenarioBtn.addEventListener('click', saveScenario);
    loadScenarioBtn.addEventListener('click', () => loadScenarioInput.click());
    loadScenarioInput.addEventListener('change', loadScenarioFromFile);
    copyLatexBtn.addEventListener('click', copyLatexToClipboard);
    addSoilLayerBtn.addEventListener('click', () => addSoilLayer());
    addPipeBtn.addEventListener('click', () => addPipe());
    addIsothermBtn.addEventListener('click', () => addIsotherm());
    addIsosurfaceBtn.addEventListener('click', () => addIsoSurface());
    toggleFluxVectors.addEventListener('change', (e) => {
        showFluxVectors = (e.target as HTMLInputElement).checked;
        if (currentCalculationData) {
            draw2DScene(currentCalculationData.sceneData);
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if(currentCalculationData && currentViewMode === '2d') {
            showTooltip(e.clientX, e.clientY, currentCalculationData.sceneData);
        }
    });
    canvas.addEventListener('mouseout', hideTooltip);
    
    viewModeRadios.forEach(radio => radio.addEventListener('change', updateView));

    // Initial Setup
    evalDateInput.valueAsDate = new Date();
    customMaterials = loadCustomMaterials();
    setupMaterialForms();
    renderMaterialLibrary();
    updateUnitsUI();
    resetToDefaults();
});
