#!/usr/bin/env python
import sqlite3
import os

db_path = 'backend/instance/gestion_productividad_v1.db'

if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Obtener nombres de tablas
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    tables = [row[0] for row in cursor.fetchall()]
    
    print(f'Tablas encontradas: {tables}')
    
    # Limpiar tablas (excepto usuario)
    for table in tables:
        if table != 'usuario':
            cursor.execute(f'DELETE FROM {table}')
            print(f'Limpiada tabla: {table}')
    
    # Verificar registros restantes
    for table in tables:
        cursor.execute(f'SELECT COUNT(*) FROM {table}')
        count = cursor.fetchone()[0]
        print(f'{table}: {count} registros')
    
    conn.commit()
    conn.close()
    print('Base de datos limpiada exitosamente.')
else:
    print(f'Base de datos no encontrada en {db_path}')
