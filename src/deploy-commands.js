require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registrando ${commands.length} comando(s) slash...`);

    if (process.env.GUILD_ID) {
      // Registro en un solo servidor de prueba (instantáneo)
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), {
        body: commands,
      });
      console.log('✅ Comandos registrados correctamente en el servidor de pruebas.');
    }

    // Registro GLOBAL (disponible en TODOS los servidores donde esté invitado el bot)
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands,
    });

    console.log('🌐 ✅ Comandos registrados GLOBALMENTE para todos los servidores.');
  } catch (error) {
    console.error(error);
  }
})();
