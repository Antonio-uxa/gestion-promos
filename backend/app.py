from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime, timedelta
from sqlalchemy import text, func, cast, String, or_
from functools import wraps
import json
import os
import re
import secrets

app = Flask(__name__)
CORS(app)

# Configuración de la Base de Datos
_db_path = os.path.join(os.path.dirname(__file__), 'instance', 'gestion_productividad_v1.db')
os.makedirs(os.path.dirname(_db_path), exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{_db_path}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'admin123')
ADMIN_SESSION_MINUTES = int(os.getenv('ADMIN_SESSION_MINUTES', '120'))
_admin_sessions = {}

def _crear_sesion_admin():
    token = secrets.token_urlsafe(32)
    expira = datetime.utcnow() + timedelta(minutes=ADMIN_SESSION_MINUTES)
    _admin_sessions[token] = expira
    return token, expira

def _token_admin_valido(token):
    if not token:
        return False
    expira = _admin_sessions.get(token)
    if not expira:
        return False
    if datetime.utcnow() > expira:
        _admin_sessions.pop(token, None)
        return False
    return True

def _require_admin(fn):
    @wraps(fn)
    def _inner(*args, **kwargs):
        token = request.headers.get('X-Admin-Token')
        if not _token_admin_valido(token):
            return jsonify({"status": "error", "message": "No autorizado"}), 401
        return fn(*args, **kwargs)
    return _inner

# --- MODELOS ---
class Usuario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(100), nullable=False)
    tiempo_general = db.Column(db.Float, default=5.0)
    config_tiempos = db.Column(db.Text, default='{}')

class Reporte(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    analista_id = db.Column(db.Integer, db.ForeignKey('usuario.id'))
    nombre_paquete = db.Column(db.String(100))
    modo = db.Column(db.String(20))
    unidades_general = db.Column(db.Integer, nullable=True)
    detalle_especifico = db.Column(db.Text, nullable=True)
    tiempo_meta = db.Column(db.Float)
    tiempo_real = db.Column(db.Float)
    rendimiento = db.Column(db.Float)
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

class Promocion(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    categoria = db.Column(db.String(100))
    nombre = db.Column(db.String(100))

class SesionPaquete(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    paquete_nombre = db.Column(db.String(120), nullable=False)
    modo = db.Column(db.String(20), nullable=False, default='GENERAL')
    started_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    ended_at = db.Column(db.DateTime, nullable=True)
    elapsed_seconds = db.Column(db.Integer, nullable=False, default=0)
    activo = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class SesionUsuarioPaquete(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuario.id'), nullable=False)
    paquete_nombre = db.Column(db.String(120), nullable=False)
    modo = db.Column(db.String(20), nullable=False, default='ESPECIFICO')
    started_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    ended_at = db.Column(db.DateTime, nullable=True)
    elapsed_seconds = db.Column(db.Integer, nullable=False, default=0)
    activo = db.Column(db.Boolean, nullable=False, default=True)
    finalizado = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class PaqueteAnalista(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(120), nullable=False, unique=True)
    tipo_paquete = db.Column(db.String(20), nullable=False, default='ESPECIFICO')
    configuracion = db.Column(db.Text, nullable=False, default='{}')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

def _serializar_paquete_analista(paquete):
    if not paquete:
        return None
    return {
        'nombre': paquete.nombre,
        'tipo_paquete': paquete.tipo_paquete,
        'configuracion': json.loads(paquete.configuracion or '{}'),
        'created_at': paquete.created_at.isoformat() + 'Z' if paquete.created_at else None,
        'updated_at': paquete.updated_at.isoformat() + 'Z' if paquete.updated_at else None,
    }

def _serializar_sesion(sesion):
    if not sesion:
        return None
    return {
        'id': sesion.id,
        'paquete_nombre': sesion.paquete_nombre,
        'modo': sesion.modo,
        'started_at': sesion.started_at.isoformat() + 'Z' if sesion.started_at else None,
        'ended_at': sesion.ended_at.isoformat() + 'Z' if sesion.ended_at else None,
        'elapsed_seconds': sesion.elapsed_seconds,
        'activo': sesion.activo,
    }

def _serializar_sesion_usuario(sesion):
    if not sesion:
        return None
    return {
        'id': sesion.id,
        'usuario_id': sesion.usuario_id,
        'paquete_nombre': sesion.paquete_nombre,
        'modo': sesion.modo,
        'started_at': sesion.started_at.isoformat() + 'Z' if sesion.started_at else None,
        'ended_at': sesion.ended_at.isoformat() + 'Z' if sesion.ended_at else None,
        'elapsed_seconds': sesion.elapsed_seconds,
        'activo': sesion.activo,
        'finalizado': bool(getattr(sesion, 'finalizado', False)),
    }

def _cerrar_sesion_usuario(sesion, finalizado=False):
    ahora = datetime.utcnow()
    sesion.ended_at = ahora
    sesion.activo = False
    sesion.elapsed_seconds = max(0, int((ahora - sesion.started_at).total_seconds()))
    sesion.finalizado = bool(finalizado)
    return sesion

def _asegurar_columna_finalizado():
    # Migración mínima para SQLite sin usar herramientas externas.
    resultado = db.session.execute(text("PRAGMA table_info('sesion_usuario_paquete')"))
    columnas = [fila[1] for fila in resultado.fetchall()]
    if 'finalizado' not in columnas:
        db.session.execute(text("ALTER TABLE sesion_usuario_paquete ADD COLUMN finalizado BOOLEAN NOT NULL DEFAULT 0"))
        db.session.commit()

def _semaforo_por_rendimiento(rendimiento):
    if rendimiento >= 0:
        return "VERDE"
    if rendimiento >= -15:
        return "AMARILLO"
    return "ROJO"

def _calcular_rendimiento(meta_min, real_min):
    meta = float(meta_min or 0)
    real = float(real_min or 0)
    if real <= 0:
        return 100 if meta > 0 else 0
    return ((meta - real) / real) * 100

def _parse_fecha_inicio(valor):
    if not valor:
        return None
    try:
        return datetime.fromisoformat(valor)
    except ValueError:
        return None

def _parse_fecha_fin(valor):
    if not valor:
        return None
    try:
        # Incluye todo el día final.
        return datetime.fromisoformat(valor) + timedelta(days=1)
    except ValueError:
        return None

def _normalizar_nombre_paquete(nombre):
    """Normaliza nombre de paquete para comparaciones consistentes."""
    texto = (nombre or '').strip().upper()
    # Unifica espacios y separadores alrededor de guiones.
    texto = re.sub(r'\s*-\s*', '-', texto)
    texto = re.sub(r'\s+', ' ', texto)
    return texto

def _obtener_alias_paquete(nombre_base):
    """Retorna todas las variantes almacenadas que representan el mismo paquete."""
    objetivo = _normalizar_nombre_paquete(nombre_base)
    if not objetivo:
        return []

    nombres = set()
    for tabla, campo in [
        (Reporte, Reporte.nombre_paquete),
        (SesionPaquete, SesionPaquete.paquete_nombre),
        (SesionUsuarioPaquete, SesionUsuarioPaquete.paquete_nombre)
    ]:
        filas = db.session.query(campo).filter(campo.isnot(None)).distinct().all()
        for (valor,) in filas:
            if _normalizar_nombre_paquete(valor) == objetivo:
                nombres.add(valor)

    return list(nombres)

def _modos_de_paquete(paquete):
    tipo = (getattr(paquete, 'tipo_paquete', '') or '').upper()
    if tipo == 'AMBOS':
        return ['GENERAL', 'ESPECIFICO']
    if tipo in ['GENERAL', 'ESPECIFICO']:
        return [tipo]
    return ['ESPECIFICO']

def _estado_paquete_modo(nombre_paquete, modo):
    modo = (modo or 'ESPECIFICO').upper()
    nombre = (nombre_paquete or '').strip()
    if not nombre:
        return 'SIN ESTADO'

    if modo == 'GENERAL':
        sesion_activa = SesionPaquete.query.filter_by(paquete_nombre=nombre, modo=modo, activo=True).order_by(SesionPaquete.id.desc()).first()
        if sesion_activa:
            return 'ACTIVO'

        ultima = SesionPaquete.query.filter_by(paquete_nombre=nombre, modo=modo).order_by(SesionPaquete.id.desc()).first()
        if ultima:
            return 'FINALIZADO' if ultima.ended_at else 'EN PROCESO'

        if Reporte.query.filter_by(nombre_paquete=nombre, modo=modo).first():
            return 'EN PROCESO'
        return 'SIN ESTADO'

    sesiones = SesionUsuarioPaquete.query.filter_by(paquete_nombre=nombre, modo=modo).all()
    if any(s.activo for s in sesiones):
        return 'ACTIVO'
    if sesiones:
        if all(bool(s.finalizado) for s in sesiones):
            return 'FINALIZADO'
        if any(s.ended_at for s in sesiones):
            return 'EN PROCESO'

    if Reporte.query.filter_by(nombre_paquete=nombre, modo=modo).first():
        return 'EN PROCESO'
    return 'SIN ESTADO'

def _estado_paquete_global(paquete):
    estados = [_estado_paquete_modo(paquete.nombre, modo) for modo in _modos_de_paquete(paquete)]
    if not estados:
        return 'SIN ESTADO'
    if 'ACTIVO' in estados:
        return 'ACTIVO'
    if 'EN PROCESO' in estados:
        return 'EN PROCESO'
    if all(estado == 'FINALIZADO' for estado in estados):
        return 'FINALIZADO'
    if any(estado != 'SIN ESTADO' for estado in estados):
        return 'EN PROCESO'
    return 'SIN ESTADO'

# --- RUTAS API ---

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.json or {}
    password = data.get('password') or ''
    if password != ADMIN_PASSWORD:
        return jsonify({"status": "error", "message": "Credenciales inválidas"}), 401

    token, expira = _crear_sesion_admin()
    return jsonify({
        "status": "ok",
        "token": token,
        "expires_at": expira.isoformat() + 'Z'
    })

@app.route('/api/admin/logout', methods=['POST'])
def admin_logout():
    token = request.headers.get('X-Admin-Token')
    if token:
        _admin_sessions.pop(token, None)
    return jsonify({"status": "ok"})

@app.route('/api/data', methods=['GET'])
def get_data():
    usuarios = Usuario.query.all()
    promos = Promocion.query.all()
    res_u = []
    for u in usuarios:
        res_u.append({
            "id": u.id, 
            "nombre": u.nombre, 
            "tiempo_general": u.tiempo_general,
            "config_tiempos": json.loads(u.config_tiempos)
        })
    return jsonify({
        "usuarios": res_u, 
        "promos": [{"id": p.id, "nombre": p.nombre, "categoria": p.categoria} for p in promos]
    })

@app.route('/api/paquetes-analista', methods=['GET'])
def obtener_paquetes_analista():
    paquetes = PaqueteAnalista.query.all()
    resultado = []
    for p in paquetes:
        resultado.append(_serializar_paquete_analista(p))
    return jsonify({"status": "ok", "paquetes": resultado})

@app.route('/api/paquetes-analista', methods=['POST'])
def guardar_paquete_analista():
    data = request.json or {}
    nombre = (data.get('nombre') or '').strip()
    tipo_paquete = (data.get('tipo_paquete') or 'ESPECIFICO').upper()
    configuracion = data.get('configuracion', {})
    expected_updated_at = (data.get('expected_updated_at') or '').strip()
    
    if not nombre:
        return jsonify({"status": "error", "message": "El nombre del paquete es obligatorio"}), 400
    
    paquete_existente = PaqueteAnalista.query.filter_by(nombre=nombre).first()
    if paquete_existente:
        actual_updated_at = paquete_existente.updated_at.isoformat() + 'Z' if paquete_existente.updated_at else ''
        if expected_updated_at and actual_updated_at and expected_updated_at != actual_updated_at:
            return jsonify({
                "status": "conflict",
                "message": "Otro usuario guardó cambios en este paquete. Se cargó la versión más reciente.",
                "paquete": _serializar_paquete_analista(paquete_existente)
            }), 409
        # Actualizar si existe
        paquete_existente.tipo_paquete = tipo_paquete
        paquete_existente.configuracion = json.dumps(configuracion)
        paquete_existente.updated_at = datetime.utcnow()
    else:
        # Crear si no existe
        paquete_nuevo = PaqueteAnalista(
            nombre=nombre,
            tipo_paquete=tipo_paquete,
            configuracion=json.dumps(configuracion)
        )
        db.session.add(paquete_nuevo)
    
    db.session.commit()
    paquete_guardado = PaqueteAnalista.query.filter_by(nombre=nombre).first()
    return jsonify({
        "status": "ok",
        "nombre": nombre,
        "updated_at": paquete_guardado.updated_at.isoformat() + 'Z' if paquete_guardado and paquete_guardado.updated_at else None,
        "paquete": _serializar_paquete_analista(paquete_guardado)
    })

@app.route('/api/paquetes-analista/<string:nombre>', methods=['PATCH'])
def actualizar_paquete_analista(nombre):
    nombre_original = (nombre or '').strip()
    data = request.json or {}
    nuevo_nombre = (data.get('nombre') or nombre_original).strip()
    tipo_paquete = (data.get('tipo_paquete') or 'ESPECIFICO').upper()
    configuracion = data.get('configuracion', {})
    expected_updated_at = (data.get('expected_updated_at') or '').strip()

    if not nombre_original:
        return jsonify({"status": "error", "message": "Nombre de paquete inválido"}), 400
    if not nuevo_nombre:
        return jsonify({"status": "error", "message": "El nombre del paquete es obligatorio"}), 400

    paquete_existente = PaqueteAnalista.query.filter_by(nombre=nombre_original).first()
    if not paquete_existente:
        return jsonify({"status": "error", "message": "Paquete no encontrado"}), 404

    if nuevo_nombre != nombre_original:
        conflicto = PaqueteAnalista.query.filter_by(nombre=nuevo_nombre).first()
        if conflicto:
            return jsonify({"status": "error", "message": "Ya existe un paquete con ese nombre"}), 409

    actual_updated_at = paquete_existente.updated_at.isoformat() + 'Z' if paquete_existente.updated_at else ''
    if expected_updated_at and actual_updated_at and expected_updated_at != actual_updated_at:
        return jsonify({
            "status": "conflict",
            "message": "Otro usuario modificó este paquete. Se cargó la versión más reciente.",
            "paquete": _serializar_paquete_analista(paquete_existente)
        }), 409

    try:
        reportes_actualizados = Reporte.query.filter(Reporte.nombre_paquete == nombre_original).update({Reporte.nombre_paquete: nuevo_nombre}, synchronize_session=False)
        sesiones_paquete_actualizadas = SesionPaquete.query.filter(SesionPaquete.paquete_nombre == nombre_original).update({SesionPaquete.paquete_nombre: nuevo_nombre}, synchronize_session=False)
        sesiones_usuario_actualizadas = SesionUsuarioPaquete.query.filter(SesionUsuarioPaquete.paquete_nombre == nombre_original).update({SesionUsuarioPaquete.paquete_nombre: nuevo_nombre}, synchronize_session=False)

        paquete_existente.nombre = nuevo_nombre
        paquete_existente.tipo_paquete = tipo_paquete
        paquete_existente.configuracion = json.dumps(configuracion)
        paquete_existente.updated_at = datetime.utcnow()

        db.session.commit()
        return jsonify({
            "status": "ok",
            "nombre": nuevo_nombre,
            "nombre_anterior": nombre_original,
            "updated_at": paquete_existente.updated_at.isoformat() + 'Z' if paquete_existente.updated_at else None,
            "paquete": _serializar_paquete_analista(paquete_existente),
            "reportes_actualizados": reportes_actualizados,
            "sesiones_paquete_actualizadas": sesiones_paquete_actualizadas,
            "sesiones_usuario_actualizadas": sesiones_usuario_actualizadas
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/paquetes-analista/<string:nombre>', methods=['DELETE'])
def eliminar_paquete_analista(nombre):
    nombre = (nombre or '').strip()
    if not nombre:
        return jsonify({"status": "error", "message": "Nombre de paquete inválido"}), 400
    
    paquete = PaqueteAnalista.query.filter_by(nombre=nombre).first()
    if not paquete:
        return jsonify({"status": "error", "message": "Paquete no encontrado"}), 404
    
    db.session.delete(paquete)
    db.session.commit()
    return jsonify({"status": "ok", "nombre": nombre})

@app.route('/api/usuarios', methods=['POST'])
@_require_admin
def crear_usuario():
    data = request.json
    nuevo = Usuario(nombre=data['nombre'], tiempo_general=5.0, config_tiempos='{}')
    db.session.add(nuevo)
    db.session.commit()
    return jsonify({
        "id": nuevo.id,
        "nombre": nuevo.nombre,
        "tiempo_general": nuevo.tiempo_general,
        "config_tiempos": {}
    })

@app.route('/api/configurar-tiempo-general', methods=['POST'])
@_require_admin
def configurar_tiempo_general():
    data = request.json
    u = Usuario.query.get(data['usuario_id'])
    if not u:
        return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404

    minutos = float(data['minutos'])
    u.tiempo_general = minutos
    db.session.commit()
    return jsonify({"status": "ok", "tiempo_general": u.tiempo_general})

@app.route('/api/usuarios/<int:usuario_id>', methods=['PUT'])
@_require_admin
def actualizar_usuario(usuario_id):
    u = Usuario.query.get(usuario_id)
    if not u:
        return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404

    data = request.json or {}
    if 'nombre' in data:
        u.nombre = data['nombre']
    if 'tiempo_general' in data and data['tiempo_general'] is not None:
        u.tiempo_general = float(data['tiempo_general'])

    db.session.commit()
    return jsonify({
        "status": "ok",
        "usuario": {
            "id": u.id,
            "nombre": u.nombre,
            "tiempo_general": u.tiempo_general,
            "config_tiempos": json.loads(u.config_tiempos)
        }
    })

@app.route('/api/usuarios/<int:usuario_id>', methods=['DELETE'])
@_require_admin
def eliminar_usuario(usuario_id):
    u = Usuario.query.get(usuario_id)
    if not u:
        return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404

    usuario_id_str = str(usuario_id)
    try:
        # Borrado robusto: contempla datos sucios guardados como texto en SQLite.
        reportes_eliminados = Reporte.query.filter(
            or_(
                Reporte.analista_id == usuario_id,
                cast(Reporte.analista_id, String) == usuario_id_str
            )
        ).delete(synchronize_session=False)

        sesiones_usuario_eliminadas = SesionUsuarioPaquete.query.filter(
            or_(
                SesionUsuarioPaquete.usuario_id == usuario_id,
                cast(SesionUsuarioPaquete.usuario_id, String) == usuario_id_str
            )
        ).delete(synchronize_session=False)

        db.session.delete(u)
        db.session.commit()
        return jsonify({
            "status": "ok",
            "usuario_eliminado_id": usuario_id,
            "reportes_eliminados": reportes_eliminados,
            "sesiones_eliminadas": sesiones_usuario_eliminadas
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/configurar-tiempo', methods=['POST'])
@_require_admin
def configurar_tiempos():
    data = request.json
    u = Usuario.query.get(data['usuario_id'])
    # Actualizar matriz específica
    matriz = json.loads(u.config_tiempos)
    matriz[str(data['promocion_id'])] = data['minutos']
    u.config_tiempos = json.dumps(matriz)
    db.session.commit() 
    return jsonify({"status": "ok"})

@app.route('/api/guardar-reporte-plural', methods=['POST'])
def guardar_reporte_plural():
    data = request.json
    ids = data.get('analista_ids', [])
    modo = data['modo'].upper()
    meta_total = float(data['tiempo_meta'])
    real_total = float(data.get('tiempo_real', 0))
    unidades_por_usuario = data.get('unidades_por_usuario', {}) or {}
    tiempos_meta_por_usuario = data.get('tiempos_meta_por_usuario', {}) or {}
    tiempos_reales_por_usuario = data.get('tiempos_reales_por_usuario', {}) or {}

    if not ids:
        return jsonify({"status": "error", "message": "No hay analistas seleccionados"}), 400

    meta_por_usuario = meta_total / len(ids)
    rendimientos = []

    for uid in ids:
        unidades_usuario = int(unidades_por_usuario.get(str(uid), unidades_por_usuario.get(uid, data.get('unidades_general', 0) or 0)))
        tiempo_meta_usuario = float(tiempos_meta_por_usuario.get(str(uid), tiempos_meta_por_usuario.get(uid, meta_por_usuario)))
        tiempo_real_usuario = float(tiempos_reales_por_usuario.get(str(uid), tiempos_reales_por_usuario.get(uid, real_total)))
        rendimiento_usuario = _calcular_rendimiento(tiempo_meta_usuario, tiempo_real_usuario)

        nuevo = Reporte(
            analista_id=uid,
            nombre_paquete=data.get('nombre_paquete', 'Lote_Grupal'),
            modo=modo,
            unidades_general=unidades_usuario,
            tiempo_meta=tiempo_meta_usuario,
            tiempo_real=tiempo_real_usuario,
            rendimiento=round(rendimiento_usuario, 2)
        )
        db.session.add(nuevo)
        rendimientos.append(rendimiento_usuario)
    
    db.session.commit()

    rendimiento_promedio = (sum(rendimientos) / len(rendimientos)) if rendimientos else 0
    return jsonify({"status": "ok", "rendimiento": round(rendimiento_promedio, 2)})

@app.route('/api/guardar-reporte-especifico', methods=['POST'])
def guardar_reporte_especifico():
    data = request.json or {}
    nombre_paquete = (data.get('nombre_paquete') or '').strip()
    usuarios = data.get('usuarios', [])

    if not nombre_paquete:
        return jsonify({"status": "error", "message": "El nombre del paquete es obligatorio"}), 400

    if not usuarios:
        return jsonify({"status": "error", "message": "No hay usuarios para guardar"}), 400

    for usuario in usuarios:
        tiempo_meta = float(usuario.get('tiempo_meta', 0))
        tiempo_real = float(usuario.get('tiempo_real', tiempo_meta))
        rendimiento = _calcular_rendimiento(tiempo_meta, tiempo_real)
        detalle_especifico = usuario.get('detalle_especifico', {})

        nuevo = Reporte(
            analista_id=usuario['analista_id'],
            nombre_paquete=nombre_paquete,
            modo='ESPECIFICO',
            detalle_especifico=json.dumps(detalle_especifico),
            tiempo_meta=tiempo_meta,
            tiempo_real=tiempo_real,
            rendimiento=round(rendimiento, 2)
        )
        db.session.add(nuevo)

    db.session.commit()
    return jsonify({"status": "ok", "registros": len(usuarios), "nombre_paquete": nombre_paquete})

@app.route('/api/paquetes/<string:nombre_paquete>', methods=['DELETE'])
@_require_admin
def eliminar_paquete(nombre_paquete):
    nombre = (nombre_paquete or '').strip()
    if not nombre:
        return jsonify({"status": "error", "message": "Nombre de paquete inválido"}), 400

    alias_paquete = _obtener_alias_paquete(nombre)
    if not alias_paquete:
        alias_paquete = [nombre]

    try:
        reportes_eliminados = Reporte.query.filter(Reporte.nombre_paquete.in_(alias_paquete)).delete(synchronize_session=False)
        sesiones_paquete_eliminadas = SesionPaquete.query.filter(SesionPaquete.paquete_nombre.in_(alias_paquete)).delete(synchronize_session=False)
        sesiones_usuario_eliminadas = SesionUsuarioPaquete.query.filter(SesionUsuarioPaquete.paquete_nombre.in_(alias_paquete)).delete(synchronize_session=False)

        db.session.commit()
        return jsonify({
            "status": "ok",
            "nombre_paquete": nombre,
            "alias_eliminados": alias_paquete,
            "reportes_eliminados": reportes_eliminados,
            "sesiones_paquete_eliminadas": sesiones_paquete_eliminadas,
            "sesiones_usuario_eliminadas": sesiones_usuario_eliminadas
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/status/opciones', methods=['GET'])
def status_opciones():
    paquetes = PaqueteAnalista.query.order_by(PaqueteAnalista.nombre.asc()).all()
    return jsonify({
        "status": "ok",
        "paquetes": [
            {
                "nombre": p.nombre,
                "fecha_creacion": p.created_at.isoformat() + 'Z' if p.created_at else None,
                "estado_paquete": _estado_paquete_global(p)
            }
            for p in paquetes if p.nombre
        ],
        "modos": ["ALL", "GENERAL", "ESPECIFICO"],
        "usuarios": [{"id": u.id, "nombre": u.nombre} for u in Usuario.query.order_by(Usuario.nombre.asc()).all()]
    })

@app.route('/api/status/resumen', methods=['GET'])
def status_resumen():
    paquetes_param = (request.args.get('paquetes') or 'ALL').strip()
    modo_param = (request.args.get('modo') or 'ALL').upper().strip()
    analista_id_param = (request.args.get('analista_id') or '').strip()
    nombre_param = (request.args.get('nombre') or '').strip()
    desde_param = (request.args.get('desde') or '').strip()
    hasta_param = (request.args.get('hasta') or '').strip()

    query = Reporte.query

    if paquetes_param and paquetes_param.upper() != 'ALL':
        paquetes = [p.strip() for p in paquetes_param.split(',') if p.strip()]
        if paquetes:
            query = query.filter(Reporte.nombre_paquete.in_(paquetes))

    if modo_param in ['GENERAL', 'ESPECIFICO']:
        query = query.filter_by(modo=modo_param)

    if analista_id_param:
        try:
            analista_id = int(analista_id_param)
            query = query.filter(Reporte.analista_id == analista_id)
        except ValueError:
            return jsonify({"status": "error", "message": "analista_id inválido"}), 400

    if nombre_param:
        termino = f"%{nombre_param.lower()}%"
        usuarios_ids = [
            u.id for u in Usuario.query.filter(
                func.lower(cast(Usuario.nombre, String)).like(termino)
            ).all()
        ]
        condiciones = [func.lower(cast(Reporte.nombre_paquete, String)).like(termino)]
        if usuarios_ids:
            condiciones.append(Reporte.analista_id.in_(usuarios_ids))
        query = query.filter(or_(*condiciones))

    fecha_desde = _parse_fecha_inicio(desde_param)
    fecha_hasta = _parse_fecha_fin(hasta_param)
    if fecha_desde:
        query = query.filter(Reporte.fecha >= fecha_desde)
    if fecha_hasta:
        query = query.filter(Reporte.fecha < fecha_hasta)

    reportes = query.order_by(Reporte.fecha.desc()).all()
    paquetes_base = PaqueteAnalista.query.all()

    usuarios = Usuario.query.all()
    mapa_usuarios = {u.id: u.nombre for u in usuarios}

    meta_total = sum(float(r.tiempo_meta or 0) for r in reportes)
    real_total = sum(float(r.tiempo_real or 0) for r in reportes)
    rendimiento_global = _calcular_rendimiento(meta_total, real_total)

    por_paquete_map = {}
    por_analista_map = {}

    for r in reportes:
        clave_paquete = f"{r.nombre_paquete}__{r.modo}"
        if clave_paquete not in por_paquete_map:
            por_paquete_map[clave_paquete] = {
                "nombre_paquete": r.nombre_paquete,
                "modo": r.modo,
                "registros": 0,
                "meta_total": 0.0,
                "real_total": 0.0,
                "fecha_creacion": r.fecha,
                "fecha_ultima": r.fecha
            }
        por_paquete_map[clave_paquete]["registros"] += 1
        por_paquete_map[clave_paquete]["meta_total"] += float(r.tiempo_meta or 0)
        por_paquete_map[clave_paquete]["real_total"] += float(r.tiempo_real or 0)
        if r.fecha and (por_paquete_map[clave_paquete]["fecha_creacion"] is None or r.fecha < por_paquete_map[clave_paquete]["fecha_creacion"]):
            por_paquete_map[clave_paquete]["fecha_creacion"] = r.fecha
        if r.fecha and (por_paquete_map[clave_paquete]["fecha_ultima"] is None or r.fecha > por_paquete_map[clave_paquete]["fecha_ultima"]):
            por_paquete_map[clave_paquete]["fecha_ultima"] = r.fecha

        aid = int(r.analista_id)
        if aid not in por_analista_map:
            por_analista_map[aid] = {
                "analista_id": aid,
                "nombre": mapa_usuarios.get(aid, f"Usuario {aid}"),
                "registros": 0,
                "meta_total": 0.0,
                "real_total": 0.0
            }
        por_analista_map[aid]["registros"] += 1
        por_analista_map[aid]["meta_total"] += float(r.tiempo_meta or 0)
        por_analista_map[aid]["real_total"] += float(r.tiempo_real or 0)

    for paquete in paquetes_base:
        if paquetes_param and paquetes_param.upper() != 'ALL':
            paquetes_filtrados = [p.strip() for p in paquetes_param.split(',') if p.strip()]
            if paquete.nombre not in paquetes_filtrados:
                continue

        for modo in _modos_de_paquete(paquete):
            if modo_param in ['GENERAL', 'ESPECIFICO'] and modo_param != modo:
                continue

            clave_paquete = f"{paquete.nombre}__{modo}"
            if clave_paquete not in por_paquete_map:
                por_paquete_map[clave_paquete] = {
                    "nombre_paquete": paquete.nombre,
                    "modo": modo,
                    "registros": 0,
                    "meta_total": 0.0,
                    "real_total": 0.0,
                    "fecha_creacion": paquete.created_at,
                    "fecha_ultima": paquete.updated_at,
                    "estado_paquete": _estado_paquete_modo(paquete.nombre, modo)
                }
            else:
                por_paquete_map[clave_paquete]["estado_paquete"] = _estado_paquete_modo(paquete.nombre, modo)
                por_paquete_map[clave_paquete]["fecha_creacion"] = por_paquete_map[clave_paquete]["fecha_creacion"] or paquete.created_at
                por_paquete_map[clave_paquete]["fecha_ultima"] = por_paquete_map[clave_paquete]["fecha_ultima"] or paquete.updated_at

    por_paquete = []
    for _, item in por_paquete_map.items():
        rendimiento = _calcular_rendimiento(item["meta_total"], item["real_total"])
        item["rendimiento"] = round(rendimiento, 2)
        item["desviacion_total"] = round(item["real_total"] - item["meta_total"], 2)
        item["semaforo"] = _semaforo_por_rendimiento(rendimiento)
        item["meta_total"] = round(item["meta_total"], 2)
        item["real_total"] = round(item["real_total"], 2)
        item["fecha_creacion"] = item["fecha_creacion"].isoformat() + 'Z' if item["fecha_creacion"] else None
        item["fecha_ultima"] = item["fecha_ultima"].isoformat() + 'Z' if item["fecha_ultima"] else None
        if not item.get("estado_paquete"):
            item["estado_paquete"] = _estado_paquete_modo(item["nombre_paquete"], item["modo"])
        por_paquete.append(item) 

    por_paquete.sort(key=lambda x: x["real_total"], reverse=True)

    por_analista = []
    for _, item in por_analista_map.items():
        rendimiento = _calcular_rendimiento(item["meta_total"], item["real_total"])
        item["rendimiento"] = round(rendimiento, 2)
        item["desviacion_total"] = round(item["real_total"] - item["meta_total"], 2)
        item["semaforo"] = _semaforo_por_rendimiento(rendimiento)
        item["meta_total"] = round(item["meta_total"], 2)
        item["real_total"] = round(item["real_total"], 2)
        por_analista.append(item)

    por_analista.sort(key=lambda x: x["rendimiento"], reverse=True)

    return jsonify({
        "status": "ok",
        "filtros": {
            "paquetes": paquetes_param,
            "modo": modo_param,
            "analista_id": analista_id_param,
            "nombre": nombre_param,
            "desde": desde_param,
            "hasta": hasta_param
        },
        "resumen_global": {
            "registros": len(reportes),
            "paquetes": len({r.nombre_paquete for r in reportes}),
            "analistas": len({r.analista_id for r in reportes}),
            "meta_total": round(meta_total, 2),
            "real_total": round(real_total, 2),
            "desviacion_total": round(real_total - meta_total, 2),
            "rendimiento_global": round(rendimiento_global, 2),
            "semaforo": _semaforo_por_rendimiento(rendimiento_global)
        },
        "por_paquete": por_paquete,
        "por_analista": por_analista
    })

@app.route('/api/sesiones-paquete', methods=['GET'])
def estado_sesion_paquete():
    nombre = (request.args.get('nombre') or '').strip()
    modo = (request.args.get('modo') or 'GENERAL').upper()
    if not nombre:
        return jsonify({"status": "error", "message": "Falta el nombre del paquete"}), 400

    activas = SesionPaquete.query.filter_by(paquete_nombre=nombre, modo=modo, activo=True).order_by(SesionPaquete.id.desc()).first()
    ultima = SesionPaquete.query.filter_by(paquete_nombre=nombre, modo=modo).order_by(SesionPaquete.id.desc()).first()
    return jsonify({
        "status": "ok",
        "activa": _serializar_sesion(activas),
        "ultima": _serializar_sesion(ultima)
    })

@app.route('/api/paquetes/iniciar', methods=['POST'])
def iniciar_sesion_paquete():
    data = request.json or {}
    nombre = (data.get('paquete_nombre') or '').strip()
    modo = (data.get('modo') or 'GENERAL').upper()

    if not nombre:
        return jsonify({"status": "error", "message": "Falta el nombre del paquete"}), 400

    sesion_activa = SesionPaquete.query.filter_by(paquete_nombre=nombre, modo=modo, activo=True).order_by(SesionPaquete.id.desc()).first()
    if sesion_activa:
        return jsonify({"status": "ok", "sesion": _serializar_sesion(sesion_activa), "reutilizada": True})

    nueva = SesionPaquete(paquete_nombre=nombre, modo=modo, started_at=datetime.utcnow(), activo=True)
    db.session.add(nueva)
    db.session.commit()
    return jsonify({"status": "ok", "sesion": _serializar_sesion(nueva), "reutilizada": False})

@app.route('/api/paquetes/finalizar', methods=['POST'])
def finalizar_sesion_paquete():
    data = request.json or {}
    nombre = (data.get('paquete_nombre') or '').strip()
    modo = (data.get('modo') or 'GENERAL').upper()

    if not nombre:
        return jsonify({"status": "error", "message": "Falta el nombre del paquete"}), 400

    sesion_activa = SesionPaquete.query.filter_by(paquete_nombre=nombre, modo=modo, activo=True).order_by(SesionPaquete.id.desc()).first()
    if not sesion_activa:
        return jsonify({"status": "error", "message": "No hay sesión activa para este paquete"}), 404

    ahora = datetime.utcnow()
    sesion_activa.ended_at = ahora
    sesion_activa.activo = False
    sesion_activa.elapsed_seconds = max(0, int((ahora - sesion_activa.started_at).total_seconds()))
    db.session.commit()
    return jsonify({"status": "ok", "sesion": _serializar_sesion(sesion_activa)})

@app.route('/api/sesiones-usuario-paquete', methods=['GET'])
def estado_sesion_usuario_paquete():
    nombre = (request.args.get('paquete') or '').strip()
    modo = (request.args.get('modo') or 'ESPECIFICO').upper()
    if not nombre:
        return jsonify({"status": "error", "message": "Falta el nombre del paquete"}), 400

    sesiones = SesionUsuarioPaquete.query.filter_by(paquete_nombre=nombre, modo=modo).order_by(SesionUsuarioPaquete.id.desc()).all()
    return jsonify({
        "status": "ok",
        "sesiones": [_serializar_sesion_usuario(sesion) for sesion in sesiones]
    })

@app.route('/api/sesiones-usuario-paquete/iniciar', methods=['POST'])
def iniciar_sesion_usuario_paquete():
    data = request.json or {}
    nombre = (data.get('paquete_nombre') or '').strip()
    modo = (data.get('modo') or 'ESPECIFICO').upper()
    usuario_id = data.get('usuario_id')

    if not nombre:
        return jsonify({"status": "error", "message": "Falta el nombre del paquete"}), 400
    if not usuario_id:
        return jsonify({"status": "error", "message": "Falta el usuario"}), 400

    sesion_finalizada = SesionUsuarioPaquete.query.filter_by(
        paquete_nombre=nombre,
        usuario_id=usuario_id,
        modo=modo,
        finalizado=True
    ).order_by(SesionUsuarioPaquete.id.desc()).first()
    if sesion_finalizada:
        return jsonify({"status": "error", "message": "Este usuario ya finalizó el paquete y no puede reiniciar."}), 409

    sesion_activa = SesionUsuarioPaquete.query.filter_by(
        paquete_nombre=nombre,
        usuario_id=usuario_id,
        modo=modo,
        activo=True
    ).order_by(SesionUsuarioPaquete.id.desc()).first()
    if sesion_activa:
        return jsonify({"status": "ok", "sesion": _serializar_sesion_usuario(sesion_activa), "reutilizada": True})

    nueva = SesionUsuarioPaquete(
        usuario_id=usuario_id,
        paquete_nombre=nombre,
        modo=modo,
        started_at=datetime.utcnow(),
        activo=True
    )
    db.session.add(nueva)
    db.session.commit()
    return jsonify({"status": "ok", "sesion": _serializar_sesion_usuario(nueva), "reutilizada": False})

@app.route('/api/sesiones-usuario-paquete/finalizar', methods=['POST'])
def finalizar_sesion_usuario_paquete():
    data = request.json or {}
    nombre = (data.get('paquete_nombre') or '').strip()
    modo = (data.get('modo') or 'ESPECIFICO').upper()
    usuario_id = data.get('usuario_id')

    if not nombre:
        return jsonify({"status": "error", "message": "Falta el nombre del paquete"}), 400
    if not usuario_id:
        return jsonify({"status": "error", "message": "Falta el usuario"}), 400

    sesion_activa = SesionUsuarioPaquete.query.filter_by(
        paquete_nombre=nombre,
        usuario_id=usuario_id,
        modo=modo,
        activo=True
    ).order_by(SesionUsuarioPaquete.id.desc()).first()
    if not sesion_activa:
        return jsonify({"status": "error", "message": "No hay sesión activa para este usuario"}), 404

    _cerrar_sesion_usuario(sesion_activa, finalizado=True)
    db.session.commit()
    return jsonify({"status": "ok", "sesion": _serializar_sesion_usuario(sesion_activa), "accion": "finalizada"})

@app.route('/api/sesiones-usuario-paquete/pausar', methods=['POST'])
def pausar_sesion_usuario_paquete():
    data = request.json or {}
    nombre = (data.get('paquete_nombre') or '').strip()
    modo = (data.get('modo') or 'ESPECIFICO').upper()
    usuario_id = data.get('usuario_id')

    if not nombre:
        return jsonify({"status": "error", "message": "Falta el nombre del paquete"}), 400
    if not usuario_id:
        return jsonify({"status": "error", "message": "Falta el usuario"}), 400

    sesion_activa = SesionUsuarioPaquete.query.filter_by(
        paquete_nombre=nombre,
        usuario_id=usuario_id,
        modo=modo,
        activo=True
    ).order_by(SesionUsuarioPaquete.id.desc()).first()
    if not sesion_activa:
        return jsonify({"status": "error", "message": "No hay sesión activa para este usuario"}), 404

    _cerrar_sesion_usuario(sesion_activa, finalizado=False)
    db.session.commit()
    return jsonify({"status": "ok", "sesion": _serializar_sesion_usuario(sesion_activa), "accion": "pausada"})

@app.route('/api/admin/limpiar-db', methods=['POST'])
@_require_admin
def limpiar_db():
    try:
        reportes_eliminados = db.session.query(Reporte).delete()
        sesiones_paquete_eliminadas = db.session.query(SesionPaquete).delete()
        sesiones_usuario_eliminadas = db.session.query(SesionUsuarioPaquete).delete()
        db.session.commit()
        return jsonify({
            "status": "ok",
            "reportes_eliminados": reportes_eliminados,
            "sesiones_paquete_eliminadas": sesiones_paquete_eliminadas,
            "sesiones_usuario_eliminadas": sesiones_usuario_eliminadas
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        _asegurar_columna_finalizado()
        if not Promocion.query.first():
            db.session.add(Promocion(categoria="Bonos", nombre="Bono Texto"))
            db.session.add(Promocion(categoria="Bonos", nombre="Bono Imagen"))
            db.session.commit()
    app.run(host='0.0.0.0', port=5000, debug=True)