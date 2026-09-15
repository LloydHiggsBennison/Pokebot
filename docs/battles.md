# Batallas y progreso individual

Instalar supabase/migrations/20260915014322_pokemon_battles_progression.sql
antes de desplegar. En SQLite las tablas y protecciones se crean automáticamente.

## Uso

1. $pokefight @usuario: el destinatario abre el panel privado y acepta o rechaza.
2. Ambos eligen una copia individual en un selector privado paginado.
3. La velocidad decide quién empieza. Los turnos alternan y duran 60 segundos.
4. Cada jugador abre su panel para elegir uno de cuatro movimientos:
   ataque 1 (15 PP), ataque 2 (10 PP), defensa (5 PP), especial (3 PP).
5. El mensaje público muestra HP, turno y última acción. Rendirse o agotar el
   tiempo concede la victoria al rival; perder todos los HP o PP también.
   Hay empate si ambos agotan sus PP o se alcanzan 100 acciones.
6. HP, PP y mejoras temporales desaparecen al terminar. Nunca se pierden copias.

El panel público no contiene elecciones privadas ni aceptación. Los datos de
batalla, turnos y bloqueos se guardan en cada transición con una revisión.
Los clics antiguos se rechazan. Tras un reinicio se puede reabrir el panel;
el proceso revisa cada 15 segundos los plazos vencidos. Si una copia ya no está
disponible al recuperar una batalla antigua, se cancela sin dar experiencia.

## Modelo de combate

Es un modo simplificado de Pokebot, no una simulación completa de los videojuegos.
Los tipos, estadísticas base y repertorios provienen de PokéAPI. Se consideran
precisión, ataque físico/especial, defensa física/especial, bonificación del tipo
propio, resistencias e inmunidades. Los efectos defensivos se limitan a proteger,
reducir ataque/precisión, aumentar ataque, curar o Transformación de Ditto.
No hay habilidades pasivas, objetos, cambios de Pokémon ni estados persistentes.

La potencia efectiva de cada movimiento se limita a 40 + 2 × nivel.
El catálogo prioriza movimientos por nivel de la versión más reciente de cada
especie; puede utilizar otro movimiento compatible cuando faltan espacios.
Charmander, Charmeleon y Charizard tienen preferencias de movimientos distintas.
Especies de repertorio reducido reciben acciones básicas del modo batalla
(Guardia, Concentración, Golpe de emergencia, Forcejeo), identificadas en el
catálogo con generic: true. No son movimientos aprendibles oficiales.

## Experiencia y estadísticas

Las copias sin nivel previo empiezan a nivel 5; se conservan los niveles existentes.
La curva es nivel³ y el máximo es 100, sin evolución. Las estadísticas se calculan
con la especie, el nivel y valores individuales deterministas de la copia. Si
existe IV total de una captura salvaje, se respeta ese total. Una transferencia
o conversión shiny conserva el ID y, por tanto, esos valores individuales.

Solo gana EXP el vencedor de una batalla con al menos cuatro acciones. Entre
la misma pareja y dentro del mismo servidor: primeras tres batallas finalizadas
en 24 horas dan 100 EXP al vencedor; de la cuarta a la décima, 25; después, cero.
El contador incluye derrotas y empates entre la pareja para evitar eludir el límite.
La entrega de EXP forma parte de la transición final y nunca se repite.

Las copias seleccionadas se bloquean mientras se combate. Un trigger impide
regalarlas, intercambiarlas, transformarlas o borrarlas durante ese plazo.
Los cambios de selección liberan la copia anterior.

## Fuente y regeneración

Ejecutar node scripts/build-battle-data.js descarga y almacena en caché fuera del
repositorio los CSV de https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv
y genera data/battle-data.json. Incluye las 1.025 especies, nombres españoles,
estadísticas, tipos, compatibilidad de movimientos y tabla de efectividad.
Las versiones se ordenan por generación y orden oficial, no por su ID numérico.
No se realizan consultas a PokéAPI durante un turno.
