import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  GridHelper,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Object3D,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import type { PatientFileExtension } from '../lib/patient-files'

export function Model3DViewer({
  url,
  extension,
}: {
  url: string
  extension: Extract<PatientFileExtension, 'stl' | 'ply' | 'obj' | 'glb'>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const generationRef = useRef(0)
  const frameIdRef = useRef(0)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const objectRef = useRef<Object3D | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const host = container
    const generation = ++generationRef.current
    const isCurrent = () => generationRef.current === generation
    setError(null)

    function releaseResources() {
      cancelAnimationFrame(frameIdRef.current)
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      controlsRef.current?.dispose()
      controlsRef.current = null
      if (objectRef.current) disposeObject(objectRef.current)
      objectRef.current = null
      rendererRef.current?.dispose()
      rendererRef.current?.domElement.remove()
      rendererRef.current = null
    }

    async function initialize() {
      try {
        const scene = new Scene()
        scene.background = null
        const camera = new PerspectiveCamera(45, 1, 0.01, 100000)
        const ambientLight = new AmbientLight(0xffffff, 1.8)
        const keyLight = new DirectionalLight(0xffffff, 2.4)
        keyLight.position.set(1, 1.5, 2)
        const fillLight = new DirectionalLight(0x9ac4bd, 1.2)
        fillLight.position.set(-1, -0.5, -1)
        scene.add(ambientLight, keyLight, fillLight)

        const renderer = new WebGLRenderer({ antialias: true, alpha: true })
        rendererRef.current = renderer
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.outputColorSpace = SRGBColorSpace
        host.replaceChildren(renderer.domElement)
        const controls = new OrbitControls(camera, renderer.domElement)
        controlsRef.current = controls
        controls.enableDamping = true
        controls.dampingFactor = 0.08
        controls.minDistance = 0.01
        controls.maxDistance = 100000

        const response = await fetch(url)
        if (!response.ok) throw new Error('No se pudo leer el modelo 3D almacenado.')
        const buffer = await response.arrayBuffer()
        if (!isCurrent()) return

        let object: Object3D
        if (extension === 'glb') {
          const loadingManager = new LoadingManager()
          loadingManager.setURLModifier((resourceUrl) => {
            if (resourceUrl.startsWith('data:') || resourceUrl.startsWith('blob:')) {
              return resourceUrl
            }
            throw new Error('El modelo intenta cargar recursos externos y fue bloqueado.')
          })
          object = await new Promise<Object3D>((resolve, reject) => {
            new GLTFLoader(loadingManager).parse(
              buffer,
              '',
              (gltf) => resolve(gltf.scene),
              reject,
            )
          })
        } else if (extension === 'obj') {
          object = new OBJLoader().parse(new TextDecoder().decode(buffer))
        } else {
          const geometry: BufferGeometry = extension === 'stl'
            ? new STLLoader().parse(buffer)
            : new PLYLoader().parse(buffer)
          if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
          object = new Mesh(
            geometry,
            new MeshStandardMaterial({
              color: 0x7aa49b,
              metalness: 0.05,
              roughness: 0.68,
            }),
          )
        }
        if (!isCurrent()) {
          disposeObject(object)
          return
        }
        objectRef.current = object
        scene.add(object)
        const bounds = new Box3().setFromObject(object)
        const center = bounds.getCenter(new Vector3())
        const size = bounds.getSize(new Vector3())
        const largestSide = Math.max(size.x, size.y, size.z)
        if (!Number.isFinite(largestSide) || largestSide <= 0) {
          throw new Error('El modelo no contiene una geometría visible.')
        }
        object.position.sub(center)
        const fitDistance = largestSide / (2 * Math.tan((camera.fov * Math.PI) / 360)) * 1.5
        camera.position.set(fitDistance, fitDistance * 0.65, fitDistance)
        camera.near = Math.max(largestSide / 10000, 0.001)
        camera.far = largestSide * 100
        camera.updateProjectionMatrix()
        controls.target.set(0, 0, 0)
        controls.update()
        const grid = new GridHelper(largestSide * 2, 20, 0x9bb7b1, 0xd8e3e1)
        grid.position.y = -size.y / 2
        scene.add(grid)

        const resize = () => {
          const { clientWidth, clientHeight } = host
          if (!clientWidth || !clientHeight) return
          renderer.setSize(clientWidth, clientHeight, false)
          camera.aspect = clientWidth / clientHeight
          camera.updateProjectionMatrix()
        }
        const observer = new ResizeObserver(resize)
        resizeObserverRef.current = observer
        observer.observe(host)
        resize()
        const render = () => {
          if (!isCurrent()) return
          frameIdRef.current = requestAnimationFrame(render)
          controls.update()
          renderer.render(scene, camera)
        }
        render()

        return () => observer.disconnect()
      } catch (caught) {
        if (isCurrent()) {
          releaseResources()
          setError(
            caught instanceof Error
              ? caught.message
              : 'No se pudo abrir el modelo 3D.',
          )
        }
      }
    }

    void initialize()

    return () => {
      if (isCurrent()) generationRef.current += 1
      releaseResources()
    }
  }, [extension, url])

  return (
    <div className="model-viewer-frame">
      <div aria-label="Visor interactivo de modelo odontológico 3D" className="model-viewer" ref={containerRef} />
      {error && <p className="form-error" role="alert">{error}</p>}
      {!error && <small>Arrastrá para girar · Usá la rueda para acercar o alejar.</small>}
    </div>
  )
}

function disposeObject(object: Object3D) {
  object.traverse((child) => {
    if (child instanceof Mesh) {
      child.geometry.dispose()
      const materials = child.material instanceof Array ? child.material : [child.material]
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof Texture) value.dispose()
        }
        material.dispose()
      }
    }
  })
}
